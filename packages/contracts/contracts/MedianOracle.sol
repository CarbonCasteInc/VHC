// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract MedianOracle is AccessControl {
    bytes32 public constant PROVIDER_ROLE = keccak256("PROVIDER_ROLE");

    struct PriceRecord {
        bytes32 commitment;
        bool revealed;
        uint256 price;
    }

    uint256 public currentEpoch;

    mapping(uint256 => mapping(address => PriceRecord)) private priceRecords;
    mapping(uint256 => uint256[]) private epochPrices;

    event EpochAdvanced(uint256 indexed newEpoch);
    event PriceCommitted(uint256 indexed epoch, address indexed provider, bytes32 commitment);
    event PriceRevealed(uint256 indexed epoch, address indexed provider, uint256 price);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PROVIDER_ROLE, msg.sender);
    }

    function setCurrentEpoch(uint256 epoch) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(epoch >= currentEpoch, "epoch regression");
        currentEpoch = epoch;
        emit EpochAdvanced(epoch);
    }

    function commitPrice(bytes32 commitment) external onlyRole(PROVIDER_ROLE) {
        uint256 epoch = currentEpoch;
        PriceRecord storage record = priceRecords[epoch][msg.sender];
        require(record.commitment == bytes32(0) || record.revealed, "commit exists");
        record.commitment = commitment;
        record.revealed = false;
        record.price = 0;
        emit PriceCommitted(epoch, msg.sender, commitment);
    }

    function revealPrice(uint256 price, uint256 salt) external onlyRole(PROVIDER_ROLE) {
        uint256 epoch = currentEpoch;
        PriceRecord storage record = priceRecords[epoch][msg.sender];
        require(record.commitment != bytes32(0), "no commit");
        require(!record.revealed, "already revealed");

        bytes32 expected = keccak256(abi.encodePacked(price, salt));
        require(expected == record.commitment, "commit mismatch");

        record.revealed = true;
        record.price = price;
        epochPrices[epoch].push(price);

        emit PriceRevealed(epoch, msg.sender, price);
    }

    function getMedian(uint256 epoch) external view returns (uint256) {
        uint256[] storage prices = epochPrices[epoch];
        require(prices.length > 0, "no prices");

        uint256[] memory sorted = new uint256[](prices.length);
        for (uint256 i = 0; i < prices.length; i++) {
            sorted[i] = prices[i];
        }

        for (uint256 i = 1; i < sorted.length; i++) {
            uint256 key = sorted[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                unchecked {
                    j--;
                }
            }
            sorted[j] = key;
        }

        uint256 mid = sorted.length / 2;
        if (sorted.length % 2 == 1) {
            return sorted[mid];
        }
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }

    function getCommitment(uint256 epoch, address provider) external view returns (PriceRecord memory) {
        return priceRecords[epoch][provider];
    }
}
