import anchor from '@coral-xyz/anchor';
import { getMXEAccAddress, getCompDefAccAddress, getCompDefAccOffset, getArciumProgramId, getArciumProgram, getLookupTableAddress, getCircuitState } from '@arcium-hq/client';
import { PublicKey } from '@solana/web3.js';
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.BioVault;
const PROGRAM_ID = program.programId;

try {
  const state = await getCircuitState(provider, PROGRAM_ID, 'authenticate');
  console.log('Circuit state:', state);
} catch(e) { console.log('Circuit state error:', e.message?.slice(0, 200)); }

const compDefOffset = Buffer.from(getCompDefAccOffset('authenticate')).readUInt32LE();
console.log('Offset:', compDefOffset);
const compDefPDA = getCompDefAccAddress(PROGRAM_ID, compDefOffset);
console.log('PDA:', compDefPDA.toString());
const info = await provider.connection.getAccountInfo(compDefPDA);
console.log('Exists:', !!info, info?.data?.length);
