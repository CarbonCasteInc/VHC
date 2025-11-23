// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IMintableERC20 {
    function mint(address to, uint256 amount) external;
}

contract UBE is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    uint256 private constant TRUST_SCORE_SCALE = 1e4; // 10000 == trust score of 1.0

    IMintableERC20 public immutable rgu;
    uint256 public dripAmount;
    uint256 public claimInterval;
    uint256 public minTrustScore;

    struct Identity {
        uint256 trustScore;
        uint256 expiresAt;
        bytes32 nullifier;
        uint256 lastClaimAt;
        bool exists;
    }

    mapping(address => Identity) private identities;
    mapping(bytes32 => address) public nullifierOwner;

    event IdentityRegistered(address indexed user, bytes32 indexed nullifier, uint256 trustScore, uint256 expiresAt);
    event UBEClaimed(address indexed user, uint256 amount, uint256 claimedAt, uint256 nextClaimAt);
    event ClaimConfigUpdated(uint256 dripAmount, uint256 claimInterval, uint256 minTrustScore);

    constructor(address rguToken, uint256 dripAmount_, uint256 claimInterval_, uint256 minTrustScore_) {
        require(rguToken != address(0), "invalid token");
        require(dripAmount_ > 0, "drip must be > 0");
        require(claimInterval_ > 0, "interval must be > 0");
        require(minTrustScore_ <= TRUST_SCORE_SCALE, "min trust too high");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTOR_ROLE, msg.sender);

        rgu = IMintableERC20(rguToken);
        dripAmount = dripAmount_;
        claimInterval = claimInterval_;
        minTrustScore = minTrustScore_;
    }

    function setClaimConfig(uint256 dripAmount_, uint256 claimInterval_, uint256 minTrustScore_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(dripAmount_ > 0, "drip must be > 0");
        require(claimInterval_ > 0, "interval must be > 0");
        require(minTrustScore_ <= TRUST_SCORE_SCALE, "min trust too high");

        dripAmount = dripAmount_;
        claimInterval = claimInterval_;
        minTrustScore = minTrustScore_;

        emit ClaimConfigUpdated(dripAmount_, claimInterval_, minTrustScore_);
    }

    function registerIdentity(
        address user,
        bytes32 nullifier,
        uint256 trustScore,
        uint256 expiresAt
    ) external onlyRole(ATTESTOR_ROLE) {
        require(user != address(0), "invalid user");
        require(expiresAt > block.timestamp, "attestation expired");
        require(trustScore <= TRUST_SCORE_SCALE, "score too high");

        address owner = nullifierOwner[nullifier];
        require(owner == address(0) || owner == user, "nullifier used");

        Identity storage record = identities[user];
        record.trustScore = trustScore;
        record.expiresAt = expiresAt;
        record.nullifier = nullifier;
        record.exists = true;

        nullifierOwner[nullifier] = user;

        emit IdentityRegistered(user, nullifier, trustScore, expiresAt);
    }

    function claim() external {
        Identity storage record = identities[msg.sender];
        require(record.exists, "not attested");
        require(record.trustScore >= minTrustScore, "trust too low");
        require(record.expiresAt > block.timestamp, "attestation expired");

        uint256 nextClaimAt = record.lastClaimAt + claimInterval;
        require(record.lastClaimAt == 0 || block.timestamp >= nextClaimAt, "claim cooldown");

        record.lastClaimAt = block.timestamp;
        rgu.mint(msg.sender, dripAmount);

        emit UBEClaimed(msg.sender, dripAmount, block.timestamp, block.timestamp + claimInterval);
    }

    function getClaimStatus(address user)
        external
        view
        returns (bool eligible, uint256 nextClaimAt, uint256 trustScore, uint256 expiresAt, bytes32 nullifier)
    {
        Identity memory record = identities[user];
        trustScore = record.trustScore;
        expiresAt = record.expiresAt;
        nullifier = record.nullifier;

        if (!record.exists) {
            return (false, 0, trustScore, expiresAt, nullifier);
        }

        nextClaimAt = record.lastClaimAt + claimInterval;
        bool cooldownSatisfied = record.lastClaimAt == 0 || block.timestamp >= nextClaimAt;
        eligible = cooldownSatisfied && record.trustScore >= minTrustScore && record.expiresAt > block.timestamp;
    }
}
