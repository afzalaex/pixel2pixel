// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract NodesV9 is ERC721, Ownable {
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

    constructor() ERC721("P2P Nodes v9", "NODE9") Ownable(msg.sender) {}

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

    function _svgForToken(uint256 tokenId) internal view returns (string memory) {
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

    function _colorForToken(uint256 tokenId) internal view returns (string memory) {
        bytes3 color = _paletteColor(_paletteIndexForToken(tokenId));
        uint24 value = uint24(color);

        bytes memory alphabet = "0123456789ABCDEF";
        bytes memory out = new bytes(7);
        out[0] = 0x23;
        out[1] = alphabet[(value >> 20) & 0x0f];
        out[2] = alphabet[(value >> 16) & 0x0f];
        out[3] = alphabet[(value >> 12) & 0x0f];
        out[4] = alphabet[(value >> 8) & 0x0f];
        out[5] = alphabet[(value >> 4) & 0x0f];
        out[6] = alphabet[value & 0x0f];
        return string(out);
    }

    function _paletteIndexForToken(uint256 tokenId) internal view returns (uint256) {
        uint256 tokenIndex = tokenId - 1;

        if (roundId <= 1) {
            return tokenIndex;
        }

        uint256 previousRound = roundId - 1;
        bytes32 previousSnapshot = finalSnapshotHashByRound[previousRound];
        if (previousSnapshot == bytes32(0)) {
            return tokenIndex;
        }

        bytes32 entropy = keccak256(abi.encodePacked(previousSnapshot, previousRound));
        uint8[100] memory positions;
        for (uint256 i = 0; i < 100; i += 1) {
            positions[i] = uint8(i);
        }

        for (uint256 i = 99; i > 0; i -= 1) {
            entropy = keccak256(abi.encodePacked(entropy));
            uint256 pick = uint256(entropy) % (i + 1);
            uint8 tmp = positions[i];
            positions[i] = positions[pick];
            positions[pick] = tmp;
        }

        return uint256(positions[tokenIndex]);
    }

    function _paletteColor(uint256 index) internal pure returns (bytes3) {
        bytes3[100] memory palette = [
            bytes3(0xD79B9B),
            bytes3(0xDA9B9B),
            bytes3(0xDE9B9B),
            bytes3(0xE19B9B),
            bytes3(0xE49B9B),
            bytes3(0xE89B9B),
            bytes3(0xEB9B9B),
            bytes3(0xEF9B9B),
            bytes3(0xF29B9B),
            bytes3(0xF59B9B),
            bytes3(0xD7AB9B),
            bytes3(0xDAAE9B),
            bytes3(0xDEB19B),
            bytes3(0xE1B59B),
            bytes3(0xE4B89B),
            bytes3(0xE8BB9B),
            bytes3(0xEBBE9B),
            bytes3(0xEFC19B),
            bytes3(0xF2C59B),
            bytes3(0xF5C99B),
            bytes3(0xC1D79B),
            bytes3(0xC4DA9B),
            bytes3(0xC7DE9B),
            bytes3(0xCBE19B),
            bytes3(0xCEE49B),
            bytes3(0xD1E89B),
            bytes3(0xD5EB9B),
            bytes3(0xD8EF9B),
            bytes3(0xDBF29B),
            bytes3(0xDFF59B),
            bytes3(0x9BD79B),
            bytes3(0x9BDA9B),
            bytes3(0x9BDE9B),
            bytes3(0x9BE19B),
            bytes3(0x9BE49B),
            bytes3(0x9BE89B),
            bytes3(0x9BEB9B),
            bytes3(0x9BEF9B),
            bytes3(0x9BF29B),
            bytes3(0x9BF59B),
            bytes3(0x9BD79B),
            bytes3(0x9BDA9B),
            bytes3(0x9BDE9B),
            bytes3(0x9BE19E),
            bytes3(0x9BE4A1),
            bytes3(0x9BE8A5),
            bytes3(0x9BEBA8),
            bytes3(0x9BEFAB),
            bytes3(0x9BF2AE),
            bytes3(0x9BF5B2),
            bytes3(0x9BD7D7),
            bytes3(0x9BDADA),
            bytes3(0x9BDEDE),
            bytes3(0x9BE1E1),
            bytes3(0x9BE4E4),
            bytes3(0x9BE8E8),
            bytes3(0x9BEBEB),
            bytes3(0x9BEFEF),
            bytes3(0x9BF2F2),
            bytes3(0x9BF5F5),
            bytes3(0x9B9BD7),
            bytes3(0x9B9BDA),
            bytes3(0x9B9BDE),
            bytes3(0x9B9EE1),
            bytes3(0x9BA1E4),
            bytes3(0x9BA5E8),
            bytes3(0x9BA8EB),
            bytes3(0x9BABEF),
            bytes3(0x9BAEF2),
            bytes3(0x9BB2F5),
            bytes3(0x9B9BD7),
            bytes3(0x9B9BDA),
            bytes3(0x9B9BDE),
            bytes3(0x9B9BE1),
            bytes3(0x9B9BE4),
            bytes3(0x9B9BE8),
            bytes3(0x9B9BEB),
            bytes3(0x9B9BEF),
            bytes3(0x9B9BF2),
            bytes3(0x9B9BF5),
            bytes3(0xC19BD7),
            bytes3(0xC49BDA),
            bytes3(0xC79BDE),
            bytes3(0xCB9BE1),
            bytes3(0xCE9BE4),
            bytes3(0xD19BE8),
            bytes3(0xD59BEB),
            bytes3(0xD89BEF),
            bytes3(0xDB9BF2),
            bytes3(0xDF9BF5),
            bytes3(0xD79BAB),
            bytes3(0xDA9BAE),
            bytes3(0xDE9BB1),
            bytes3(0xE19BB5),
            bytes3(0xE49BB8),
            bytes3(0xE89BBB),
            bytes3(0xEB9BBE),
            bytes3(0xEF9BC1),
            bytes3(0xF29BC5),
            bytes3(0xF59BC9)
        ];
        return palette[index];
    }
}
