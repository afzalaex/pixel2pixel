// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract NodesV8 is ERC721, Ownable {
    using Strings for uint256;

    uint256 public constant MAX_SUPPLY = 100;

    uint256 public nextTokenId = 1;
    uint256 public roundId = 1;
    bool public gameActive;

    bytes32 public finalSnapshotHash;
    uint256 public finalArtworkTokenId;
    address public finalAuctionContract;
    address public finalArtworkContract;

    mapping(address => uint256) private _nodeOf;
    mapping(address => bool) private _hasMinted;

    mapping(uint256 => bytes32) public finalSnapshotHashByRound;
    mapping(uint256 => uint256) public finalArtworkTokenIdByRound;

    event NodeMinted(address indexed wallet, uint256 indexed tokenId);
    event GameActivated(uint256 indexed totalSupply);
    event GameReset(uint256 indexed roundId, uint256 indexed totalSupply);
    event FinalAuctionContractSet(address indexed finalAuctionContract);
    event FinalArtworkContractSet(address indexed finalArtworkContract);
    event FinalSnapshotLocked(uint256 indexed roundId, bytes32 indexed snapshotHash);
    event FinalArtworkTokenRegistered(uint256 indexed roundId, uint256 indexed tokenId);

    constructor() ERC721("P2PNodes", "NODE") Ownable(msg.sender) {}

    function nodeOf(address wallet) external view returns (uint256) {
        return _nodeOf[wallet];
    }

    function hasMinted(address wallet) external view returns (bool) {
        return _hasMinted[wallet];
    }

    function totalSupply() public view returns (uint256) {
        return nextTokenId - 1;
    }

    function setFinalAuctionContract(address auctionAddress) external onlyOwner {
        require(auctionAddress != address(0), "Invalid auction");
        finalAuctionContract = auctionAddress;
        emit FinalAuctionContractSet(auctionAddress);
    }

    function setFinalArtworkContract(address artworkAddress) external onlyOwner {
        require(artworkAddress != address(0), "Invalid artwork");
        finalArtworkContract = artworkAddress;
        emit FinalArtworkContractSet(artworkAddress);
    }

    function mint() external returns (uint256 tokenId) {
        require(!gameActive, "Game active");
        require(!_hasMinted[msg.sender], "Already minted");
        require(nextTokenId <= MAX_SUPPLY, "All nodes minted");
        require(_nodeOf[msg.sender] == 0, "Wallet already has node");

        tokenId = nextTokenId;
        nextTokenId += 1;
        _hasMinted[msg.sender] = true;

        _safeMint(msg.sender, tokenId);
        emit NodeMinted(msg.sender, tokenId);

        if (tokenId == MAX_SUPPLY) {
            gameActive = true;
            emit GameActivated(MAX_SUPPLY);
        }
    }

    function lockFinalSnapshot(bytes32 snapshotHash) external {
        require(
            msg.sender == owner() || msg.sender == finalAuctionContract,
            "Not authorized"
        );
        require(totalSupply() == MAX_SUPPLY, "Minting incomplete");
        require(snapshotHash != bytes32(0), "Invalid snapshot");
        require(finalSnapshotHashByRound[roundId] == bytes32(0), "Snapshot already set");

        finalSnapshotHashByRound[roundId] = snapshotHash;
        finalSnapshotHash = snapshotHash;

        emit FinalSnapshotLocked(roundId, snapshotHash);
    }

    function registerFinalArtworkToken(uint256 tokenId) external {
        require(msg.sender == finalArtworkContract, "Only final artwork");
        require(tokenId != 0, "Invalid token");
        require(finalSnapshotHashByRound[roundId] != bytes32(0), "Snapshot not set");
        require(finalArtworkTokenIdByRound[roundId] == 0, "Artwork already set");

        finalArtworkTokenIdByRound[roundId] = tokenId;
        finalArtworkTokenId = tokenId;

        emit FinalArtworkTokenRegistered(roundId, tokenId);
    }

    function shuffleSeed() external view returns (bytes32) {
        bytes32 snapshotHash = finalSnapshotHashByRound[roundId];
        require(snapshotHash != bytes32(0), "Snapshot not set");
        return keccak256(abi.encodePacked(snapshotHash, roundId));
    }

    function resetGame() external onlyOwner {
        require(finalSnapshotHashByRound[roundId] != bytes32(0), "Snapshot not set");
        require(finalArtworkTokenIdByRound[roundId] != 0, "Final artwork not minted");

        gameActive = false;
        roundId += 1;
        finalSnapshotHash = bytes32(0);
        finalArtworkTokenId = 0;

        emit GameReset(roundId, totalSupply());
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);

        string memory svg = _svgForToken(tokenId);
        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(svg))
        );

        uint256 row = ((tokenId - 1) / 10) + 1;
        uint256 col = ((tokenId - 1) % 10) + 1;
        string memory color = _colorForToken(tokenId);

        string memory metadata = string.concat(
            '{"name":"P2P Node #',
            tokenId.toString(),
            '","description":"Pixel2Pixel node with deterministic on-chain SVG pixel.","image":"',
            image,
            '","attributes":[{"trait_type":"Node","value":"',
            tokenId.toString(),
            '"},{"trait_type":"Row","value":"',
            row.toString(),
            '"},{"trait_type":"Column","value":"',
            col.toString(),
            '"},{"trait_type":"Color","value":"',
            color,
            '"}]}'
        );

        return
            string.concat(
                "data:application/json;base64,",
                Base64.encode(bytes(metadata))
            );
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        from = _ownerOf(tokenId);

        if (to != address(0) && to != from) {
            require(_nodeOf[to] == 0, "Wallet already has node");
        }

        address previousOwner = super._update(to, tokenId, auth);

        if (previousOwner != address(0)) {
            _nodeOf[previousOwner] = 0;
        }
        if (to != address(0)) {
            _nodeOf[to] = tokenId;
        }

        return previousOwner;
    }

    function _svgForToken(uint256 tokenId) internal pure returns (string memory) {
        string memory color = _colorForToken(tokenId);

        return
            string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">',
                '<rect width="120" height="120" fill="',
                color,
                '"/>',
                "</svg>"
            );
    }

    function _colorForToken(uint256 tokenId) internal pure returns (string memory) {
        bytes32 hash = keccak256(abi.encodePacked(tokenId));

        uint8 r = (uint8(hash[0]) / 2) + 64;
        uint8 g = (uint8(hash[1]) / 2) + 64;
        uint8 b = (uint8(hash[2]) / 2) + 64;

        bytes memory alphabet = "0123456789ABCDEF";
        bytes memory out = new bytes(7);
        out[0] = 0x23;

        out[1] = alphabet[r >> 4];
        out[2] = alphabet[r & 0x0f];
        out[3] = alphabet[g >> 4];
        out[4] = alphabet[g & 0x0f];
        out[5] = alphabet[b >> 4];
        out[6] = alphabet[b & 0x0f];

        return string(out);
    }
}
