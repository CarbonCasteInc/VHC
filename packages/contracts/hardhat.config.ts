import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

const TESTNET_PRIVATE_KEY = process.env.TESTNET_PRIVATE_KEY;
const sepoliaUrl = process.env.SEPOLIA_RPC_URL || '';
const baseSepoliaUrl = process.env.BASE_SEPOLIA_RPC_URL || '';

if (process.env.MAINNET_PRIVATE_KEY) {
  // Avoid accidental mainnet use from the testnet deploy flow.
  console.warn('[hardhat] MAINNET_PRIVATE_KEY is ignored. Use TESTNET_PRIVATE_KEY for Sepolia/Base.');
}

const testnetAccounts = TESTNET_PRIVATE_KEY ? [TESTNET_PRIVATE_KEY] : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  defaultNetwork: 'hardhat',
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337
    },
    sepolia: {
      url: sepoliaUrl,
      chainId: 11155111,
      accounts: testnetAccounts
    },
    baseSepolia: {
      url: baseSepoliaUrl,
      chainId: 84532,
      accounts: testnetAccounts
    }
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  },
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6'
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.TESTNET_ETHERSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || '',
      baseSepolia: process.env.BASESCAN_API_KEY || process.env.TESTNET_ETHERSCAN_API_KEY || ''
    },
    customChains: [
      {
        network: 'baseSepolia',
        chainId: 84532,
        urls: {
          apiURL: 'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org'
        }
      }
    ]
  }
};

export default config;
