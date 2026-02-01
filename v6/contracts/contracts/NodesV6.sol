// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract NodesV6 is ERC721, Ownable {
    uint256 public constant MAX_NODES = 100;
    uint256 public nextNodeId = 1;

    mapping(address => uint256) public nodeOf;

    constructor() ERC721("P2P Nodes v6", "NODE6") Ownable(msg.sender) {}

    function mint() external {
        require(nodeOf[msg.sender] == 0, "Already owns a node");
        require(nextNodeId <= MAX_NODES, "All nodes minted");

        uint256 nodeId = nextNodeId;
        nextNodeId++;

        nodeOf[msg.sender] = nodeId;
        _safeMint(msg.sender, nodeId);
    }

    /* =====================
       SVG (v6 foundation)
    ===================== */

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent token");

        return string(
            abi.encodePacked(
                "data:image/svg+xml;utf8,",
                "<svg xmlns='http://www.w3.org/2000/svg' width='500' height='500'>",
                "<rect width='500' height='500' fill='black'/>",
                "<text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle'",
                " fill='white' font-size='32' font-family='monospace'>",
                "NODE ",
                _toString(tokenId),
                "</text></svg>"
            )
        );
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

