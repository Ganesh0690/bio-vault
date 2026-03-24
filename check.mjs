import { getCompDefAccAddress, getCompDefAccOffset } from '@arcium-hq/client';
import { PublicKey, Connection } from '@solana/web3.js';
const c = new Connection('https://api.devnet.solana.com');
const PID = new PublicKey('6moFPWkC7mw9Df7WNyEQbmb5GBvp4bfswWGKV8WQH7ai');
const off = Buffer.from(getCompDefAccOffset('authenticate')).readUInt32LE();
const pda = getCompDefAccAddress(PID, off);
console.log('PDA:', pda.toString());
const info = await c.getAccountInfo(pda);
console.log('Exists:', !!info, info?.data?.length);
