// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract QuadraticFunding is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");
    bytes32 public constant TREASURER_ROLE = keccak256("TREASURER_ROLE");

    uint256 private constant TRUST_SCORE_SCALE = 1e4; // 10000 == trust score of 1.0

    IERC20 public immutable rgu;
    uint256 public minTrustScore;
    uint256 public projectCount;
    uint256 private totalWeight;
    uint256 public matchingPool;
    uint256 public distributedMatching;
    bool public roundClosed;

    struct Participant {
        uint256 trustScore;
        uint256 expiresAt;
        bool exists;
    }

    struct Project {
        address recipient;
        uint256 totalContributions;
        uint256 sumOfSqrtContributions;
        bool exists;
        bool withdrawn;
    }

    mapping(address => Participant) private participants;
    mapping(uint256 => Project) private projects;
    mapping(uint256 => mapping(address => uint256)) private contributions;

    event ParticipantRecorded(address indexed user, uint256 trustScore, uint256 expiresAt);
    event ProjectRegistered(uint256 indexed projectId, address indexed recipient);
    event VoteCast(uint256 indexed projectId, address indexed voter, uint256 amount, uint256 totalContribution);
    event MatchingPoolFunded(address indexed from, uint256 amount, uint256 totalPool);
    event RoundClosed(uint256 indexed atBlock);
    event FundsWithdrawn(uint256 indexed projectId, address indexed recipient, uint256 amount);
    event MinTrustScoreUpdated(uint256 minTrustScore);

    constructor(address rguToken, uint256 minTrustScore_) {
        require(rguToken != address(0), "invalid token");
        require(minTrustScore_ <= TRUST_SCORE_SCALE, "min trust too high");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTOR_ROLE, msg.sender);
        _grantRole(TREASURER_ROLE, msg.sender);

        rgu = IERC20(rguToken);
        minTrustScore = minTrustScore_;
    }

    function setMinTrustScore(uint256 newThreshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newThreshold <= TRUST_SCORE_SCALE, "min trust too high");
        minTrustScore = newThreshold;
        emit MinTrustScoreUpdated(newThreshold);
    }

    function recordParticipant(address user, uint256 trustScore, uint256 expiresAt) external onlyRole(ATTESTOR_ROLE) {
        require(user != address(0), "invalid user");
        require(expiresAt > block.timestamp, "attestation expired");
        require(trustScore <= TRUST_SCORE_SCALE, "score too high");

        participants[user] = Participant({trustScore: trustScore, expiresAt: expiresAt, exists: true});
        emit ParticipantRecorded(user, trustScore, expiresAt);
    }

    function registerProject(address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 projectId) {
        require(recipient != address(0), "invalid recipient");

        projectId = ++projectCount;
        projects[projectId] = Project({
            recipient: recipient,
            totalContributions: 0,
            sumOfSqrtContributions: 0,
            exists: true,
            withdrawn: false
        });

        emit ProjectRegistered(projectId, recipient);
    }

    function fundMatchingPool(uint256 amount) external onlyRole(TREASURER_ROLE) {
        require(amount > 0, "amount required");
        matchingPool += amount;
        bool ok = rgu.transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        emit MatchingPoolFunded(msg.sender, amount, matchingPool);
    }

    function castVote(uint256 projectId, uint256 amount) external {
        require(!roundClosed, "round closed");
        require(amount > 0, "amount required");

        Project storage project = projects[projectId];
        require(project.exists, "invalid project");

        Participant memory participant = participants[msg.sender];
        require(participant.exists, "not attested");
        require(participant.expiresAt > block.timestamp, "attestation expired");
        require(participant.trustScore >= minTrustScore, "trust too low");

        uint256 previousContribution = contributions[projectId][msg.sender];
        uint256 newContribution = previousContribution + amount;
        contributions[projectId][msg.sender] = newContribution;

        uint256 previousRoot = Math.sqrt(previousContribution);
        uint256 newRoot = Math.sqrt(newContribution);
        uint256 oldWeight = project.sumOfSqrtContributions * project.sumOfSqrtContributions;

        project.sumOfSqrtContributions = project.sumOfSqrtContributions + newRoot - previousRoot;
        project.totalContributions += amount;

        uint256 newWeight = project.sumOfSqrtContributions * project.sumOfSqrtContributions;
        totalWeight = totalWeight + newWeight - oldWeight;

        bool ok = rgu.transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");

        emit VoteCast(projectId, msg.sender, amount, newContribution);
    }

    function closeRound() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(!roundClosed, "round already closed");
        roundClosed = true;
        emit RoundClosed(block.number);
    }

    function previewMatch(uint256 projectId) public view returns (uint256) {
        Project memory project = projects[projectId];
        if (!project.exists || project.sumOfSqrtContributions == 0 || totalWeight == 0) {
            return 0;
        }
        uint256 weight = project.sumOfSqrtContributions * project.sumOfSqrtContributions;
        return (matchingPool * weight) / totalWeight;
    }

    function withdraw(uint256 projectId) external {
        require(roundClosed, "round open");

        Project storage project = projects[projectId];
        require(project.exists, "invalid project");
        require(!project.withdrawn, "already withdrawn");
        require(project.recipient == msg.sender, "not recipient");

        uint256 matchAmount = previewMatch(projectId);
        uint256 totalPayout = project.totalContributions + matchAmount;
        project.withdrawn = true;

        if (matchAmount > 0) {
            uint256 newDistributed = distributedMatching + matchAmount;
            require(newDistributed <= matchingPool, "matching exhausted");
            distributedMatching = newDistributed;
        }

        bool ok = rgu.transfer(msg.sender, totalPayout);
        require(ok, "transfer failed");

        emit FundsWithdrawn(projectId, msg.sender, totalPayout);
    }

    function contributionOf(uint256 projectId, address user) external view returns (uint256) {
        return contributions[projectId][user];
    }

    function projectDetails(uint256 projectId) external view returns (Project memory) {
        return projects[projectId];
    }

    function participantInfo(address user) external view returns (Participant memory) {
        return participants[user];
    }

    function matchingWeight() external view returns (uint256) {
        return totalWeight;
    }
}
