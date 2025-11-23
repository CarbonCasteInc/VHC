// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

contract Faucet is AccessControl {
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    uint256 private constant TRUST_SCORE_SCALE = 1e4; // 10000 == trust score of 1.0

    IMintableToken public immutable rgu;
    uint256 public dripAmount;
    uint256 public cooldown;
    uint256 public minTrustScore; // scaled by TRUST_SCORE_SCALE

    struct Attestation {
        uint256 trustScore;
        uint256 expiresAt;
        bool exists;
    }

    mapping(address => Attestation) private attestations;
    mapping(address => uint256) public lastClaimAt;

    event AttestationRecorded(address indexed user, uint256 trustScore, uint256 expiresAt);
    event AttestationRevoked(address indexed user);
    event FaucetDrip(address indexed user, uint256 amount, uint256 nextClaimAt);
    event ConfigUpdated(uint256 dripAmount, uint256 cooldown, uint256 minTrustScore);

    constructor(address rguToken, uint256 dripAmount_, uint256 cooldown_, uint256 minTrustScore_) {
        require(rguToken != address(0), "invalid token");
        require(dripAmount_ > 0, "drip must be > 0");
        require(cooldown_ > 0, "cooldown must be > 0");
        require(minTrustScore_ <= TRUST_SCORE_SCALE, "min trust too high");

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ATTESTOR_ROLE, msg.sender);

        rgu = IMintableToken(rguToken);
        dripAmount = dripAmount_;
        cooldown = cooldown_;
        minTrustScore = minTrustScore_;
    }

    function setConfig(uint256 dripAmount_, uint256 cooldown_, uint256 minTrustScore_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(dripAmount_ > 0, "drip must be > 0");
        require(cooldown_ > 0, "cooldown must be > 0");
        require(minTrustScore_ <= TRUST_SCORE_SCALE, "min trust too high");

        dripAmount = dripAmount_;
        cooldown = cooldown_;
        minTrustScore = minTrustScore_;

        emit ConfigUpdated(dripAmount_, cooldown_, minTrustScore_);
    }

    function recordAttestation(address user, uint256 trustScore, uint256 expiresAt) external onlyRole(ATTESTOR_ROLE) {
        require(user != address(0), "invalid user");
        require(expiresAt > block.timestamp, "attestation expired");
        require(trustScore <= TRUST_SCORE_SCALE, "score too high");

        attestations[user] = Attestation({trustScore: trustScore, expiresAt: expiresAt, exists: true});
        emit AttestationRecorded(user, trustScore, expiresAt);
    }

    function revokeAttestation(address user) external onlyRole(ATTESTOR_ROLE) {
        delete attestations[user];
        emit AttestationRevoked(user);
    }

    function claim() external {
        Attestation memory attestation = attestations[msg.sender];
        require(attestation.exists, "not attested");
        require(attestation.expiresAt > block.timestamp, "attestation expired");
        require(attestation.trustScore >= minTrustScore, "trust too low");

        uint256 last = lastClaimAt[msg.sender];
        require(last == 0 || block.timestamp >= last + cooldown, "cooldown active");

        lastClaimAt[msg.sender] = block.timestamp;
        rgu.mint(msg.sender, dripAmount);

        emit FaucetDrip(msg.sender, dripAmount, block.timestamp + cooldown);
    }

    function getAttestation(address user) external view returns (Attestation memory) {
        return attestations[user];
    }
}
