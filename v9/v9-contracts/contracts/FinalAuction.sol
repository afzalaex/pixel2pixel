// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";

interface INodesV8 {
    function nodeOf(address wallet) external view returns (uint256);

    function ownerOf(uint256 tokenId) external view returns (address);

    function roundId() external view returns (uint256);

    function lockFinalSnapshot(bytes32 snapshotHash) external;

    function finalSnapshotHashByRound(uint256 round) external view returns (bytes32);

    function finalArtworkTokenIdByRound(uint256 round) external view returns (uint256);
}

contract FinalAuction is Ownable {
    INodesV8 public immutable nodes;

    bool public auctionActive;
    bool public finalized;
    uint256 public auctionEnd;
    uint256 public auctionRoundId;
    bytes32 public snapshotHash;

    address public highestBidder;
    uint256 public highestBid;

    mapping(address => uint256) public pendingReturns;
    mapping(uint256 => mapping(address => bool)) public hasBidInRound;

    event AuctionActivated(
        uint256 indexed roundId,
        bytes32 indexed snapshotHash,
        uint256 indexed auctionEnd
    );
    event BidPlaced(uint256 indexed roundId, address indexed bidder, uint256 amount);
    event RefundWithdrawn(address indexed bidder, uint256 amount);
    event AuctionFinalized(uint256 indexed roundId, address indexed winner, uint256 amount);
    event AuctionClosedWithoutWinner(uint256 indexed roundId);

    constructor(address nodesAddress) Ownable(msg.sender) {
        require(nodesAddress != address(0), "Invalid nodes");
        nodes = INodesV8(nodesAddress);
    }

    function activateAuction(bytes32 seedHash, uint256 durationSeconds) external onlyOwner {
        require(!auctionActive, "Auction active");
        require(seedHash != bytes32(0), "Invalid seed hash");
        require(durationSeconds > 0, "Invalid duration");

        if (auctionRoundId != 0 && finalized) {
            require(
                nodes.finalArtworkTokenIdByRound(auctionRoundId) != 0,
                "Previous artwork unclaimed"
            );
        }

        uint256 round = nodes.roundId();
        require(nodes.finalArtworkTokenIdByRound(round) == 0, "Artwork already minted");

        snapshotHash = seedHash;
        auctionRoundId = round;
        auctionEnd = block.timestamp + durationSeconds;
        auctionActive = true;
        finalized = false;
        highestBidder = address(0);
        highestBid = 0;

        bytes32 existingSnapshot = nodes.finalSnapshotHashByRound(round);
        if (existingSnapshot == bytes32(0)) {
            nodes.lockFinalSnapshot(seedHash);
        } else {
            require(existingSnapshot == seedHash, "Snapshot mismatch");
        }

        emit AuctionActivated(round, seedHash, auctionEnd);
    }

    function bid() external payable {
        require(auctionActive, "Auction inactive");
        require(block.timestamp < auctionEnd, "Auction ended");
        require(msg.value > highestBid, "Bid too low");
        require(!hasBidInRound[auctionRoundId][msg.sender], "Already bid");
        _requireNodeOwner(msg.sender);

        hasBidInRound[auctionRoundId][msg.sender] = true;

        if (highestBidder != address(0)) {
            pendingReturns[highestBidder] += highestBid;
        }

        highestBidder = msg.sender;
        highestBid = msg.value;

        emit BidPlaced(auctionRoundId, msg.sender, msg.value);
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

        if (highestBidder == address(0)) {
            auctionActive = false;
            finalized = false;
            emit AuctionClosedWithoutWinner(auctionRoundId);
            return;
        }

        auctionActive = false;
        finalized = true;

        (bool paid, ) = payable(owner()).call{value: highestBid}("");
        require(paid, "Payout failed");

        emit AuctionFinalized(auctionRoundId, highestBidder, highestBid);
    }

    function _requireNodeOwner(address bidder) internal view {
        uint256 nodeId = nodes.nodeOf(bidder);
        require(nodeId != 0, "Only node owners");
        require(nodes.ownerOf(nodeId) == bidder, "Only node owners");
    }
}
