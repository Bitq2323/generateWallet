const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');
const axios = require('axios');

function isMnemonic(key) {
    return bip39.validateMnemonic(key);
}

function isWIF(key, network) {
    try {
        bitcoin.ECPair.fromWIF(key, network);
        return true;
    } catch {
        return false;
    }
}

function deriveKeyPairFromSeed(type, seed, network) {
    let path;
    switch (type) {
        case 'BIP84':
            path = "m/84'/0'/0'/0/0";
            break;
        case 'BIP49':
            path = "m/49'/0'/0'/0/0";
            break;
        case 'BIP44':
            path = "m/44'/0'/0'/0/0";
            break;
        default:
            throw new Error('Invalid address type');
    }
    return bitcoin.bip32.fromSeed(seed, network).derivePath(path);
}

function deriveKeyPairFromNode(type, node) {
    let path;
    switch (type) {
        case 'BIP84':
            path = "m/84'/0'/0'/0/0";
            break;
        case 'BIP49':
            path = "m/49'/0'/0'/0/0";
            break;
        case 'BIP44':
            path = "m/44'/0'/0'/0/0";
            break;
        default:
            throw new Error('Invalid address type');
    }
    return node.derivePath(path);
}

async function getBalance(address) {
    try {
        const response = await axios.get(`https://mempool.space/api/address/${address}`);
        return response.data.chain_stats.funded_txo_sum - response.data.chain_stats.spent_txo_sum;
    } catch (error) {
        console.error('Error fetching balance:', error);
        return null;
    }
}

async function generateAllAddressDetails(key, isImporting = false) {
    const NETWORK = bitcoin.networks.bitcoin;
    let seed, keyPair, addresses = {}, highestBalance = 0, addressWithHighestBalance = {};

    if (isMnemonic(key)) {
        seed = bip39.mnemonicToSeedSync(key);
        keyPair = deriveKeyPairFromSeed('BIP84', seed, NETWORK); // Derive initial keyPair to avoid undefined error
    } else if (isWIF(key, NETWORK)) {
        keyPair = bitcoin.ECPair.fromWIF(key, NETWORK);
    } else {
        throw new Error('Invalid key format. Must be a mnemonic or WIF.');
    }

    const types = ['BIP84', 'BIP49', 'BIP44'];
    for (let type of types) {
        if (isMnemonic(key)) {
            keyPair = deriveKeyPairFromSeed(type, seed, NETWORK); // seed is now defined in the upper scope
        } 
        // Note: The else part for WIF handling is not needed as keyPair is already defined

        let address, balance;
        switch (type) {
            case 'BIP84':
                address = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
                break;
            case 'BIP49':
                address = bitcoin.payments.p2sh({
                    redeem: bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: NETWORK }),
                    network: NETWORK
                }).address;
                break;
            case 'BIP44':
                address = bitcoin.payments.p2pkh({ pubkey: keyPair.publicKey, network: NETWORK }).address;
                break;
        }

        if (isImporting) {
            balance = await getBalance(address);
            if (balance > highestBalance) {
                highestBalance = balance;
                addressWithHighestBalance = {
                    type: type,
                    address: address,
                    wif: keyPair.toWIF(),
                    balance: balance
                };
            }
        }
        addresses[type] = {
            address: address,
            wif: keyPair.toWIF(),
            balance: balance
        };
    }

    let result = {
        addresses: addresses,
        mnemonic: isMnemonic(key) ? key : null
    };

    if (highestBalance > 0) {
        result.addressWithHighestBalance = addressWithHighestBalance;
    }

    return result;
}

// Main Cloud Function
exports.generateAddresses = async (req, res) => {
    const key = req.body.key;
    const isImporting = req.body.isImporting || false;

    try {
        const details = await generateAllAddressDetails(key, isImporting);
        res.status(200).send(details);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).send({ error: 'Internal Server Error' });
    }
};