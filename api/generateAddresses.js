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

    let mnemonic;
    if (isImporting && key !== "0") {
        if (!key) {
            throw new Error('Key is required for importing.');
        }
        if (isMnemonic(key)) {
            seed = bip39.mnemonicToSeedSync(key);
        } else if (isWIF(key, NETWORK)) {
            keyPair = bitcoin.ECPair.fromWIF(key, NETWORK);
        } else {
            throw new Error('Invalid key format for import. Must be a mnemonic or WIF.');
        }
    } else {
        mnemonic = bip39.generateMnemonic();
        console.log("Generated Mnemonic:", mnemonic);
        seed = bip39.mnemonicToSeedSync(mnemonic);
    }

    
    const types = ['BIP84', 'BIP49', 'BIP44'];
    for (let type of types) {
        if (!keyPair) { // Create keyPair only if not already defined (for WIF case)
            keyPair = deriveKeyPairFromSeed(type, seed, NETWORK);
        }

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
        mnemonic: isImporting && key !== "0" ? key : mnemonic
    };

    if (highestBalance > 0) {
        result.addressWithHighestBalance = addressWithHighestBalance;
    }

    return result;
}

module.exports = async (req, res) => {
    try {
        if(req.method === 'POST') {
            const { key, isImporting } = req.body;
            const details = await generateAllAddressDetails(key, isImporting);
            res.status(200).send(details);
        } else {
            res.status(405).send({ error: 'Method Not Allowed' });
        }
    } catch (error) {
        console.error('Detailed Error:', error);
        res.status(500).send({ error: 'Internal Server Error', details: error.message });
    }
};
