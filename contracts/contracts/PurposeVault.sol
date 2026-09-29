// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Escrow for one purpose-bound remittance. The relayer cannot choose the payee or the INR amount.
contract PurposeVault is Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 50;
    uint256 public constant USD_SCALE = 1_000_000;

    enum Purpose {
        Tuition,
        Medical,
        Rent,
        General
    }

    enum Category {
        Unregistered,
        School,
        Hospital,
        Utility,
        Landlord
    }

    enum Status {
        None,
        Open,
        PayoutPending,
        PayoutUnknown,
        Settled,
        Refunded
    }

    struct Quote {
        uint256 ratePaisePerUsd;
        uint256 validUntil;
        bool active;
    }

    struct Remittance {
        address sender;
        bytes32 beneficiaryCommitment;
        bytes32 authorizedPayeeCommitment;
        Purpose purpose;
        uint256 grossUsd6;
        uint256 feeUsd6;
        uint256 netUsd6;
        uint256 netInrPaise;
        uint256 ratePaisePerUsd;
        uint256 expiry;
        bytes32 quoteId;
        Status status;
        bytes32 payoutId;
    }

    IERC20 public immutable usd;
    address public relayer;
    address public treasury;
    Quote public quote;
    uint256 public remittanceCount;
    mapping(bytes32 => Category) public registry;
    mapping(uint256 => Remittance) public remittances;

    error QuoteExpired();
    error BadQuote();
    error UnregisteredPayee();
    error CategoryMismatch();
    error PayeeNotAuthorized();
    error InvalidStatus();
    error PayoutIdMismatch();
    error NotRelayer();
    error ZeroAmount();
    error NotSender();
    error BadTreasury();

    event QuoteSet(uint256 ratePaisePerUsd, uint256 validUntil, bytes32 quoteId);
    event PayeeRegistered(bytes32 indexed commitment, Category category);
    event RemittanceCreated(
        uint256 indexed id,
        address indexed sender,
        bytes32 beneficiaryCommitment,
        bytes32 authorizedPayeeCommitment,
        Purpose purpose,
        uint256 grossUsd6,
        uint256 feeUsd6,
        uint256 netUsd6,
        uint256 netInrPaise,
        bytes32 quoteId
    );
    event RemittanceReserved(
        uint256 indexed id,
        bytes32 payoutId,
        bytes32 quoteId,
        uint256 grossUsd6,
        uint256 feeUsd6,
        uint256 netUsd6,
        uint256 netInrPaise
    );
    event RemittanceSettled(
        uint256 indexed id,
        bytes32 payoutId,
        bytes32 quoteId,
        uint256 grossUsd6,
        uint256 feeUsd6,
        uint256 netUsd6,
        uint256 netInrPaise
    );
    event PayoutMarkedUnknown(uint256 indexed id, bytes32 payoutId);
    event Refunded(uint256 indexed id, uint256 grossUsd6);

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(IERC20 usd_, address relayer_, address treasury_) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert BadTreasury();
        usd = usd_;
        relayer = relayer_;
        treasury = treasury_;
    }

    function setRelayer(address next) external onlyOwner {
        relayer = next;
    }

    function setQuote(uint256 ratePaisePerUsd, uint256 validUntil) external onlyOwner {
        if (ratePaisePerUsd == 0 || validUntil <= block.timestamp) revert BadQuote();
        quote = Quote({ratePaisePerUsd: ratePaisePerUsd, validUntil: validUntil, active: true});
        emit QuoteSet(ratePaisePerUsd, validUntil, _quoteId(ratePaisePerUsd, validUntil));
    }

    function registerPayee(bytes32 commitment, Category category) external onlyOwner {
        if (category == Category.Unregistered) revert UnregisteredPayee();
        registry[commitment] = category;
        emit PayeeRegistered(commitment, category);
    }

    function deregisterPayee(bytes32 commitment) external onlyOwner {
        registry[commitment] = Category.Unregistered;
    }

    function commitmentOf(string calldata vpa) external pure returns (bytes32) {
        return keccak256(bytes(vpa));
    }

    function computePayoutId(uint256 id) public view returns (bytes32) {
        return keccak256(abi.encode(block.chainid, address(this), id));
    }

    function currentQuoteId() public view returns (bytes32) {
        return _quoteId(quote.ratePaisePerUsd, quote.validUntil);
    }

    /// @dev Reverts with the first policy failure. A view, so the trick page can label it as a preview.
    function previewPayout(uint256 id, bytes32 payeeCommitment) external view {
        Remittance storage row = remittances[id];
        if (row.status == Status.None) revert InvalidStatus();
        _enforcePayee(payeeCommitment, row.purpose, row.authorizedPayeeCommitment);
    }

    function createRemittance(
        bytes32 beneficiaryCommitment,
        bytes32 authorizedPayeeCommitment,
        Purpose purpose,
        uint256 grossUsd6
    ) external returns (uint256 id) {
        if (!quote.active || block.timestamp > quote.validUntil) revert QuoteExpired();
        if (grossUsd6 == 0) revert ZeroAmount();
        _enforcePayee(authorizedPayeeCommitment, purpose, authorizedPayeeCommitment);

        uint256 feeUsd6 = (grossUsd6 * FEE_BPS) / 10_000;
        uint256 netUsd6 = grossUsd6 - feeUsd6;
        uint256 netInrPaise = (netUsd6 * quote.ratePaisePerUsd) / USD_SCALE;
        bytes32 quoteId = _quoteId(quote.ratePaisePerUsd, quote.validUntil);

        id = remittanceCount;
        remittanceCount = id + 1;

        remittances[id] = Remittance({
            sender: msg.sender,
            beneficiaryCommitment: beneficiaryCommitment,
            authorizedPayeeCommitment: authorizedPayeeCommitment,
            purpose: purpose,
            grossUsd6: grossUsd6,
            feeUsd6: feeUsd6,
            netUsd6: netUsd6,
            netInrPaise: netInrPaise,
            ratePaisePerUsd: quote.ratePaisePerUsd,
            expiry: quote.validUntil,
            quoteId: quoteId,
            status: Status.Open,
            payoutId: bytes32(0)
        });

        usd.safeTransferFrom(msg.sender, address(this), grossUsd6);

        emit RemittanceCreated(
            id,
            msg.sender,
            beneficiaryCommitment,
            authorizedPayeeCommitment,
            purpose,
            grossUsd6,
            feeUsd6,
            netUsd6,
            netInrPaise,
            quoteId
        );
    }

    /// @notice No payee argument and no amount argument. Both are already stored.
    function reservePayout(uint256 id) external onlyRelayer {
        Remittance storage row = remittances[id];
        if (row.status != Status.Open) revert InvalidStatus();
        _enforcePayee(row.authorizedPayeeCommitment, row.purpose, row.authorizedPayeeCommitment);
        if (block.timestamp > row.expiry) revert QuoteExpired();

        bytes32 payoutId = computePayoutId(id);
        row.payoutId = payoutId;
        row.status = Status.PayoutPending;

        emit RemittanceReserved(id, payoutId, row.quoteId, row.grossUsd6, row.feeUsd6, row.netUsd6, row.netInrPaise);
    }

    function confirmPayout(uint256 id, bytes32 payoutId) external onlyRelayer {
        Remittance storage row = remittances[id];
        if (row.status != Status.PayoutPending && row.status != Status.PayoutUnknown) revert InvalidStatus();
        if (row.payoutId != payoutId || payoutId == bytes32(0)) revert PayoutIdMismatch();
        uint256 gross = row.grossUsd6;
        row.status = Status.Settled;
        usd.safeTransfer(treasury, gross);
        emit RemittanceSettled(id, payoutId, row.quoteId, row.grossUsd6, row.feeUsd6, row.netUsd6, row.netInrPaise);
    }

    function markUnknown(uint256 id, bytes32 payoutId) external onlyRelayer {
        Remittance storage row = remittances[id];
        if (row.status != Status.PayoutPending) revert InvalidStatus();
        if (row.payoutId != payoutId) revert PayoutIdMismatch();
        row.status = Status.PayoutUnknown;
        emit PayoutMarkedUnknown(id, payoutId);
    }

    function refund(uint256 id) external {
        Remittance storage row = remittances[id];
        if (msg.sender != row.sender) revert NotSender();
        if (row.status != Status.Open) revert InvalidStatus();
        if (block.timestamp <= row.expiry) revert QuoteExpired();
        uint256 gross = row.grossUsd6;
        row.status = Status.Refunded;
        usd.safeTransfer(row.sender, gross);
        emit Refunded(id, gross);
    }

    function _quoteId(uint256 ratePaisePerUsd, uint256 validUntil) internal pure returns (bytes32) {
        return keccak256(abi.encode(ratePaisePerUsd, validUntil, FEE_BPS));
    }

    function _enforcePayee(bytes32 payee, Purpose purpose, bytes32 authorized) internal view {
        Category category = registry[payee];
        if (category == Category.Unregistered) revert UnregisteredPayee();
        if (purpose != Purpose.General && category != _required(purpose)) revert CategoryMismatch();
        if (payee != authorized) revert PayeeNotAuthorized();
    }

    function _required(Purpose purpose) internal pure returns (Category) {
        if (purpose == Purpose.Tuition) return Category.School;
        if (purpose == Purpose.Medical) return Category.Hospital;
        if (purpose == Purpose.Rent) return Category.Landlord;
        return Category.Unregistered;
    }
}
