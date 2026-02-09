// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface INodesV7 {
    function nodeOf(address wallet) external view returns (uint256);
    function ownerOf(uint256 tokenId) external view returns (address);
}

contract FinalAuction is ERC721, Ownable {
    uint256 public constant FINAL_TOKEN_ID = 1;

    INodesV7 public immutable nodes;

    bool public auctionActive;
    bool public finalized;
    uint256 public auctionEnd;
    bytes32 public snapshotHash;

    address public highestBidder;
    uint256 public highestBid;

    mapping(address => uint256) public pendingReturns;

    event AuctionActivated(bytes32 indexed snapshotHash, uint256 indexed auctionEnd);
    event BidPlaced(address indexed bidder, uint256 amount);
    event RefundWithdrawn(address indexed bidder, uint256 amount);
    event AuctionFinalized(address indexed winner, uint256 amount);

    constructor(address nodesAddress)
        ERC721("Pixel2Pixel Final Artwork", "P2PFINAL")
        Ownable(msg.sender)
    {
        require(nodesAddress != address(0), "Invalid nodes");
        nodes = INodesV7(nodesAddress);
    }

    function activateAuction(bytes32 seedHash, uint256 durationSeconds) external onlyOwner {
        require(!auctionActive && !finalized, "Auction already used");
        require(seedHash != bytes32(0), "Invalid seed hash");
        require(durationSeconds > 0, "Invalid duration");

        snapshotHash = seedHash;
        auctionEnd = block.timestamp + durationSeconds;
        auctionActive = true;

        emit AuctionActivated(seedHash, auctionEnd);
    }

    function bid() external payable {
        require(auctionActive, "Auction inactive");
        require(block.timestamp < auctionEnd, "Auction ended");
        require(msg.value > highestBid, "Bid too low");
        _requireNodeOwner(msg.sender);

        if (highestBidder != address(0)) {
            pendingReturns[highestBidder] += highestBid;
        }

        highestBidder = msg.sender;
        highestBid = msg.value;

        emit BidPlaced(msg.sender, msg.value);
    }

    function withdrawRefund() external {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "No refund");

        pendingReturns[msg.sender] = 0;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "Refund failed");

        emit RefundWithdrawn(msg.sender, amount);
    }

    function finalizeAuction() external {
        require(auctionActive, "Auction inactive");
        require(block.timestamp >= auctionEnd, "Auction still running");
        require(highestBidder != address(0), "No bids");

        auctionActive = false;
        finalized = true;

        _safeMint(highestBidder, FINAL_TOKEN_ID);

        (bool paid, ) = payable(owner()).call{value: highestBid}("");
        require(paid, "Payout failed");

        emit AuctionFinalized(highestBidder, highestBid);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory svg = _finalSvg();
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        );

        string memory metadata = string.concat(
            '{"name":"P2P Final 1/1","description":"Final artwork minted from terminal snapshot auction.","image":"',
            image,
            '","attributes":[{"trait_type":"Snapshot Hash","value":"',
            Strings.toHexString(uint256(snapshotHash), 32),
            '"}]}'
        );

        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(metadata))
        );
    }

    function _finalSvg() internal view returns (string memory) {
        string memory color = _colorFromHash(snapshotHash);

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">',
            '<rect width="600" height="600" fill="#000000"/>',
            '<rect x="60" y="60" width="480" height="480" fill="',
            color,
            '"/>',
            '<rect x="250" y="250" width="100" height="100" fill="#000000"/>',
            "</svg>"
        );
    }

    function _requireNodeOwner(address bidder) internal view {
        uint256 nodeId = nodes.nodeOf(bidder);
        require(nodeId != 0, "Only node owners");
        require(nodes.ownerOf(nodeId) == bidder, "Only node owners");
    }

    function _colorFromHash(bytes32 hash) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789ABCDEF";
        bytes memory out = new bytes(7);
        out[0] = 0x23;

        out[1] = alphabet[uint8(hash[0]) >> 4];
        out[2] = alphabet[uint8(hash[0]) & 0x0f];
        out[3] = alphabet[uint8(hash[1]) >> 4];
        out[4] = alphabet[uint8(hash[1]) & 0x0f];
        out[5] = alphabet[uint8(hash[2]) >> 4];
        out[6] = alphabet[uint8(hash[2]) & 0x0f];

        return string(out);
    }
}
