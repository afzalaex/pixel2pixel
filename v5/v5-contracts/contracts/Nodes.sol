// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Nodes is ERC721, Ownable {
    uint256 public constant MAX_NODES = 100;
    uint256 public nextNodeId = 1;

    // 🔑 THIS IS THE KEY FIX
    mapping(address => uint256) public nodeOf;

    constructor() ERC721("P2PNodes", "NODE") Ownable(msg.sender) {}

    function mint() external {
        require(nodeOf[msg.sender] == 0, "Already minted");
        require(nextNodeId <= MAX_NODES, "All nodes minted");

        uint256 nodeId = nextNodeId;
        nextNodeId++;

        nodeOf[msg.sender] = nodeId; // ✅ STORE OWNERSHIP
        _safeMint(msg.sender, nodeId);
    }
}

