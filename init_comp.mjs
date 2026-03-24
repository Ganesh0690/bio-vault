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
} catch(e) { console.log('No circuit state:', e.message?.slice(0, 100)); }
const mxeAddr = getMXEAccAddress(PROGRAM_ID);
const arcProg = getArciumProgram(provider);
const mxeAcc = await arcProg.account.mxeAccount.fetch(mxeAddr);
const lutAddr = getLookupTableAddress(PROGRAM_ID, mxeAcc.lutOffsetSlot);
const compDefOffset = Buffer.from(getCompDefAccOffset('authenticate')).readUInt32LE();
const compDefPDA = getCompDefAccAddress(PROGRAM_ID, compDefOffset);
const LUT_PROGRAM = new PublicKey('AddressLookupTab1e1111111111111111111111111');
try {
  const tx = await program.methods.initAuthenticateCompDef().accounts({
    payer: provider.publicKey, mxeAccount: mxeAddr, compDefAccount: compDefPDA,
    arciumProgram: getArciumProgramId(), systemProgram: anchor.web3.SystemProgram.programId,
    addressLookupTable: lutAddr, lutProgram: LUT_PROGRAM,
  }).rpc({ commitment: 'confirmed' });
  console.log('Success:', tx);
} catch(e) {
  console.log('Error:', e.message?.slice(0, 500));
  if (e.logs) console.log('Logs:', e.logs.join('\n'));
}
