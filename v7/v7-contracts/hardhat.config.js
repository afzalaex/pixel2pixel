require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const networks = {};
const hardhat = {};

if (process.env.SEPOLIA_RPC && process.env.PRIVATE_KEY) {
  networks.sepolia = {
    url: process.env.SEPOLIA_RPC,
    accounts: [process.env.PRIVATE_KEY],
  };
}

if (process.env.FORK_RPC) {
  hardhat.forking = {
    url: process.env.FORK_RPC,
  };
}

module.exports = {
  solidity: "0.8.28",
  networks: {
    hardhat,
    ...networks,
  },
  mocha: {
    timeout: 120000,
  },
};
