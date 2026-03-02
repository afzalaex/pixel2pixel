// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

interface IFinalAuction {
    function finalized() external view returns (bool);

    function highestBidder() external view returns (address);

    function snapshotHash() external view returns (bytes32);

    function auctionRoundId() external view returns (uint256);
}

interface INodesV8ForArtwork {
    function finalSnapshotHashByRound(uint256 round) external view returns (bytes32);

    function registerFinalArtworkToken(uint256 tokenId) external;
}

contract FinalArtwork is ERC721, Ownable {
    using Strings for uint256;

    IFinalAuction public immutable auction;
    INodesV8ForArtwork public immutable nodes;

    uint256 public nextTokenId = 1;

    mapping(uint256 => uint256) public tokenIdByRound;
    mapping(uint256 => uint256) public roundByToken;
    mapping(uint256 => bytes32) public snapshotHashByToken;
    mapping(uint256 => string) private _svgByToken;

    event FinalArtworkClaimed(
        uint256 indexed roundId,
        uint256 indexed tokenId,
        address indexed winner,
        bytes32 snapshotHash
    );

    constructor(address auctionAddress, address nodesAddress)
        ERC721("Pixel2Pixel Final Artwork", "P2PFINAL")
        Ownable(msg.sender)
    {
        require(auctionAddress != address(0), "Invalid auction");
        require(nodesAddress != address(0), "Invalid nodes");

        auction = IFinalAuction(auctionAddress);
        nodes = INodesV8ForArtwork(nodesAddress);
    }

    function claim(string calldata deterministicSvg) external returns (uint256 tokenId) {
        require(bytes(deterministicSvg).length > 0, "Empty SVG");
        require(auction.finalized(), "Auction not finalized");

        address winner = auction.highestBidder();
        require(winner != address(0), "No winner");
        require(msg.sender == winner, "Only auction winner");

        uint256 round = auction.auctionRoundId();
        require(round != 0, "Round not set");
        require(tokenIdByRound[round] == 0, "Already claimed");

        bytes32 snapshotHash = auction.snapshotHash();
        require(snapshotHash != bytes32(0), "Snapshot missing");
        require(nodes.finalSnapshotHashByRound(round) == snapshotHash, "Snapshot mismatch");

        tokenId = nextTokenId;
        nextTokenId += 1;

        tokenIdByRound[round] = tokenId;
        roundByToken[tokenId] = round;
        snapshotHashByToken[tokenId] = snapshotHash;
        _svgByToken[tokenId] = deterministicSvg;

        _safeMint(msg.sender, tokenId);
        nodes.registerFinalArtworkToken(tokenId);

        emit FinalArtworkClaimed(round, tokenId, msg.sender, snapshotHash);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory svg = _svgByToken[tokenId];
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        );

        string memory metadata = string.concat(
            '{"name":"P2P Final Artwork #',
            tokenId.toString(),
            '","description":"Final 1/1 artwork minted after terminal seeding and auction settlement.","image":"',
            image,
            '","attributes":[{"trait_type":"Round","value":"',
            roundByToken[tokenId].toString(),
            '"},{"trait_type":"Snapshot Hash","value":"',
            Strings.toHexString(uint256(snapshotHashByToken[tokenId]), 32),
            '"}]}'
        );

        return
            string.concat(
                "data:application/json;base64,",
                Base64.encode(bytes(metadata))
            );
    }
}
