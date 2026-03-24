import { useState, useCallback } from "react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Program, BN } from "@coral-xyz/anchor";
import { Buffer } from "buffer";
import {
  x25519, RescueCipher, getMXEPublicKey, getMXEAccAddress,
  getCompDefAccAddress, getClusterAccAddress, getComputationAccAddress,
  getMempoolAccAddress, getExecutingPoolAccAddress, getFeePoolAccAddress,
  getClockAccAddress, getCompDefAccOffset, getArciumProgramId,
  awaitComputationFinalization, deserializeLE,
} from "@arcium-hq/client";
window.Buffer = Buffer;

const PROGRAM_ID = new PublicKey("F1VtpPEhWZSn1fBdQ8ju5F7Rv4VPTfn8XHPi59cpiHa");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const CLUSTER_OFFSET = 456;
import IDL from "./idl/veil_dao.json";

function randomBytes(n: number): Buffer { return Buffer.from(crypto.getRandomValues(new Uint8Array(n))); }
function toArr32(data: any): number[] { const r: number[] = []; for (let i = 0; i < 32; i++) r.push(typeof data[i] === "number" ? data[i] & 0xff : 0); return r; }
function shorten(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }

type View = "landing" | "app";
type Status = "idle" | "encrypting" | "computing" | "complete" | "error";

function getProvider() {
  const s = (window as any).solana;
  return s?.isPhantom ? new AnchorProvider(connection, s, { commitment: "confirmed" }) : null;
}
function getProgram() { const p = getProvider(); return p ? new Program(IDL as any, p) : null; }
async function getMXEPubKeyRetry(provider: AnchorProvider, pid: PublicKey, retries = 5): Promise<Uint8Array> {
  for (let i = 0; i < retries; i++) {
    try { const k = await getMXEPublicKey(provider, pid); if (k) return k; } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error("Failed to get MXE key");
}

const proposals = [
  { id: 1, title: "Allocate 500 SOL to Developer Grants", desc: "Fund ecosystem developer grants for Q2 2026", treasury: "500 SOL" },
  { id: 2, title: "Deploy Liquidity to Raydium Pool", desc: "Add 1000 SOL to RAY/SOL concentrated liquidity", treasury: "1000 SOL" },
  { id: 3, title: "Burn 10% of Treasury Tokens", desc: "Deflationary measure to increase token value", treasury: "10% supply" },
];

export default function App() {
  const [view, setView] = useState<View>("landing");
  const [wallet, setWallet] = useState("");
  const [connected, setConnected] = useState(false);
  const [balance, setBalance] = useState(0);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState(0);
  const [chainMsg, setChainMsg] = useState("");
  const [txSigs, setTxSigs] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [voteResult, setVoteResult] = useState<{txSig: string} | null>(null);
  const [selectedProposal, setSelectedProposal] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState(0);
  const [stakeWeight, setStakeWeight] = useState("100");

  const connect = useCallback(async () => {
    try {
      const s = (window as any).solana;
      if (!s?.isPhantom) { alert("Install Phantom — Devnet"); return; }
      const r = await s.connect(); setWallet(r.publicKey.toString()); setConnected(true); setView("app");
      setBalance((await connection.getBalance(r.publicKey)) / 1e9);
    } catch {}
  }, []);
  const disconnect = useCallback(async () => {
    try { await (window as any).solana?.disconnect(); } catch {}
    setWallet(""); setConnected(false); setView("landing"); setTxSigs([]);
  }, []);

  const initOnChain = useCallback(async () => {
    const prog = getProgram(); if (!prog) return;
    setChainMsg("Initializing DAO...");
    try {
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("program_state")], PROGRAM_ID);
      const info = await connection.getAccountInfo(pda);
      if (info) { setChainMsg("DAO already initialized"); }
      else { const tx = await prog.methods.initialize().accounts({ authority: new PublicKey(wallet), programState: pda, systemProgram: SystemProgram.programId }).rpc(); setTxSigs(p => [...p, tx]); setChainMsg("DAO initialized — " + shorten(tx)); }
    } catch (e: any) { setChainMsg(e.message?.includes("already") ? "Already initialized" : "Error: " + e.message?.slice(0, 60)); }
    try {
      const compDefOffset = Buffer.from(getCompDefAccOffset("submit_ballot")).readUInt32LE();
      const compDefInfo = await connection.getAccountInfo(getCompDefAccAddress(PROGRAM_ID, compDefOffset));
      if (compDefInfo) { setChainMsg("DAO ready — ballot circuit loaded"); } else { setChainMsg("Comp def not found"); }
    } catch {}
  }, [wallet]);

  const submitBallot = useCallback(async () => {
    const provider = getProvider(); const prog = getProgram();
    if (!provider || !prog) return;
    setVoteResult(null); setErrorMsg("");
    setStatus("encrypting"); setProgress(15);
    setChainMsg("Fetching MXE x25519 public key...");
    try {
      const mxePubKey = await getMXEPubKeyRetry(provider, PROGRAM_ID);
      setProgress(25); setChainMsg("Encrypting ballot with Rescue cipher...");
      const privKey = x25519.utils.randomPrivateKey();
      const pubKey = x25519.getPublicKey(privKey);
      const sharedSecret = x25519.getSharedSecret(privKey, mxePubKey);
      const cipher = new RescueCipher(sharedSecret as any);
      const nonce = randomBytes(16);

      const ctChoice = cipher.encrypt([BigInt(selectedChoice)], nonce);
      const ctWeight = cipher.encrypt([BigInt(stakeWeight)], nonce);
      const ctProposal = cipher.encrypt([BigInt(proposals[selectedProposal].id)], nonce);
      setProgress(45); setChainMsg("Ballot sealed. Submitting to Arcium MPC...");

      const computationOffset = new BN(randomBytes(8), "hex");
      const compDefOffset = Buffer.from(getCompDefAccOffset("submit_ballot")).readUInt32LE();
      setStatus("computing"); setProgress(55);
      setChainMsg("Encrypted ballot queued on Solana...");

      const queueTx = await prog.methods.submitBallot(
        computationOffset,
        toArr32(ctChoice[0]), toArr32(ctWeight[0]), toArr32(ctProposal[0]),
        toArr32(pubKey), new BN(deserializeLE(nonce).toString()),
      ).accountsPartial({
        payer: provider.publicKey,
        mxeAccount: getMXEAccAddress(PROGRAM_ID),
        mempoolAccount: getMempoolAccAddress(CLUSTER_OFFSET),
        executingPool: getExecutingPoolAccAddress(CLUSTER_OFFSET),
        computationAccount: getComputationAccAddress(CLUSTER_OFFSET, computationOffset),
        compDefAccount: getCompDefAccAddress(PROGRAM_ID, compDefOffset),
        clusterAccount: getClusterAccAddress(CLUSTER_OFFSET),
        poolAccount: getFeePoolAccAddress(),
        clockAccount: getClockAccAddress(),
        systemProgram: SystemProgram.programId,
      }).rpc({ commitment: "confirmed" });

      setTxSigs(p => [...p, queueTx]); setProgress(65);
      setChainMsg("Ballot queued! Tx: " + shorten(queueTx) + ". ARX nodes processing...");
      setProgress(80); setChainMsg("MPC nodes validating ballot on secret shares...");

      const finalizeTx = await awaitComputationFinalization(provider, computationOffset, PROGRAM_ID, "confirmed", 120000);
      setTxSigs(p => [...p, finalizeTx]); setProgress(100);
      setVoteResult({ txSig: finalizeTx });
      setStatus("complete"); setChainMsg("Ballot verified! Callback: " + shorten(finalizeTx));
    } catch (e: any) {
      console.error("Ballot error:", e);
      setErrorMsg(e.message?.slice(0, 120) || "Unknown"); setStatus("error");
      setChainMsg("Error: " + (e.message?.slice(0, 80) || "Unknown"));
    }
  }, [wallet, selectedChoice, stakeWeight, selectedProposal]);

  const reset = useCallback(() => { setStatus("idle"); setProgress(0); setVoteResult(null); setChainMsg(""); setErrorMsg(""); }, []);
  const choices = ["For", "Against", "Abstain", "Veto"];

  if (view === "landing") return (
    <div style={{minHeight:"100vh",background:"linear-gradient(180deg,#0a0f0a 0%,#0d1a0d 100%)",color:"#e5e5e5",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"24px 48px",maxWidth:1200,margin:"0 auto"}}>
        <div style={{fontSize:"1.375rem",fontWeight:800,letterSpacing:"-0.04em"}}>VEIL<span style={{color:"#34d399",fontWeight:400}}>dao</span></div>
        <button onClick={connect} style={{background:"linear-gradient(135deg,#059669,#34d399)",color:"#0a0f0a",border:"none",padding:"10px 28px",borderRadius:8,fontWeight:700,fontSize:"0.8125rem",cursor:"pointer",letterSpacing:"0.02em"}}>Enter App →</button>
      </nav>
      <section style={{padding:"120px 48px 80px",maxWidth:1200,margin:"0 auto",textAlign:"center"}}>
        <div style={{display:"inline-block",background:"rgba(52,211,153,0.08)",border:"1px solid rgba(52,211,153,0.15)",borderRadius:999,padding:"6px 16px",fontSize:"0.75rem",fontWeight:600,color:"#34d399",letterSpacing:"0.06em",marginBottom:28}}>ANONYMOUS DAO GOVERNANCE</div>
        <h1 style={{fontSize:"clamp(3rem,6vw,5rem)",fontWeight:800,lineHeight:1.05,letterSpacing:"-0.04em",marginBottom:24,maxWidth:700,margin:"0 auto 24px"}}>Treasury decisions,<br/><span style={{color:"#34d399"}}>completely private.</span></h1>
        <p style={{fontSize:"1.125rem",lineHeight:1.7,color:"rgba(255,255,255,0.45)",maxWidth:560,margin:"0 auto 40px"}}>DAO members vote on fund allocations with encrypted ballots. Votes are tallied inside Arcium MPC. Only final results are published — individual votes stay permanently hidden.</p>
        <div style={{display:"flex",gap:12,justifyContent:"center"}}>
          <button onClick={connect} style={{background:"linear-gradient(135deg,#059669,#34d399)",color:"#0a0f0a",border:"none",padding:"16px 40px",borderRadius:8,fontWeight:700,fontSize:"1rem",cursor:"pointer"}}>Launch VeilDAO</button>
          <a href="https://github.com/Ganesh0690/veil-dao" target="_blank" rel="noreferrer" style={{background:"transparent",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.1)",padding:"16px 40px",borderRadius:8,fontWeight:600,fontSize:"1rem",textDecoration:"none"}}>View Source</a>
        </div>
      </section>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,maxWidth:1200,margin:"0 auto",padding:"0 48px 80px",background:"rgba(255,255,255,0.02)",borderRadius:16}}>
        {[["🔐","Encrypted ballots","Votes sealed with Rescue cipher via x25519 key exchange. Your choice, stake weight, and proposal ID are all encrypted."],["⚡","MPC tallying","Arcium ARX nodes process ballots on secret-shared data. No single node ever sees any individual vote."],["✓","On-chain proof","Every ballot generates a verifiable Solana transaction. Computation finalized via BLS-signed callback."]].map(([icon,t,d],i) =>
          <div key={i} style={{padding:"36px 28px",borderRight: i < 2 ? "1px solid rgba(255,255,255,0.04)" : "none"}}>
            <div style={{fontSize:"1.5rem",marginBottom:12}}>{icon}</div>
            <div style={{fontSize:"1rem",fontWeight:700,marginBottom:8,letterSpacing:"-0.01em"}}>{t}</div>
            <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)",lineHeight:1.65}}>{d}</div>
          </div>)}
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(180deg,#0a0f0a 0%,#0d1a0d 100%)",color:"#e5e5e5",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 48px",maxWidth:1200,margin:"0 auto"}}>
        <div style={{fontSize:"1.375rem",fontWeight:800,letterSpacing:"-0.04em"}}>VEIL<span style={{color:"#34d399",fontWeight:400}}>dao</span></div>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <span onClick={() => setView("landing")} style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)",cursor:"pointer"}}>Home</span>
          <span style={{fontFamily:"monospace",fontSize:"0.6875rem",color:"rgba(255,255,255,0.3)",padding:"5px 10px",background:"rgba(255,255,255,0.04)",borderRadius:6}}>{shorten(wallet)}</span>
          <button onClick={disconnect} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.3)",cursor:"pointer",fontSize:"0.75rem"}}>Exit</button>
        </div>
      </nav>
      <div style={{maxWidth:1200,margin:"0 auto",padding:"0 48px 60px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"rgba(52,211,153,0.04)",border:"1px solid rgba(52,211,153,0.08)",borderRadius:10,marginBottom:20,fontSize:"0.8125rem",color:"rgba(255,255,255,0.4)"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#34d399"}}/> Solana Devnet · Arcium MPC Cluster 456
          <span style={{fontFamily:"monospace",marginLeft:8,fontSize:"0.6875rem"}}>{shorten(PROGRAM_ID.toString())}</span>
          <span style={{marginLeft:"auto",color:"#34d399",fontWeight:600}}>{balance.toFixed(2)} SOL</span>
          {status==="computing"&&<span style={{color:"#34d399",fontSize:"0.75rem",animation:"pulse 1.5s infinite"}}>● MPC Processing</span>}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <button onClick={initOnChain} style={{background:"rgba(52,211,153,0.1)",color:"#34d399",border:"1px solid rgba(52,211,153,0.2)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Initialize DAO</button>
          {chainMsg && <span style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)",alignSelf:"center",marginLeft:8}}>{chainMsg}</span>}
        </div>
        {txSigs.length > 0 && <div style={{padding:"12px 16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:10,marginBottom:20}}>
          <div style={{fontSize:"0.5625rem",fontWeight:700,color:"#34d399",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Verified Transactions</div>
          {txSigs.map((sig, i) => <a key={i} href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{fontFamily:"monospace",fontSize:"0.6875rem",color:"rgba(255,255,255,0.3)",textDecoration:"none",display:"block",marginBottom:3}}>{shorten(sig)} ↗</a>)}
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          <div>
            <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Active Proposals</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {proposals.map((p, i) => (
                <div key={i} onClick={() => { setSelectedProposal(i); reset(); }}
                  style={{padding:"18px 20px",background: selectedProposal === i ? "rgba(52,211,153,0.06)" : "rgba(255,255,255,0.02)",
                    border: selectedProposal === i ? "1px solid rgba(52,211,153,0.2)" : "1px solid rgba(255,255,255,0.04)",borderRadius:12,cursor:"pointer",transition:"all 0.15s"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{fontSize:"0.9375rem",fontWeight:700,letterSpacing:"-0.01em"}}>{p.title}</span>
                    <span style={{fontSize:"0.6875rem",fontWeight:600,color:"#34d399",background:"rgba(52,211,153,0.1)",padding:"3px 10px",borderRadius:999}}>{p.treasury}</span>
                  </div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)"}}>{p.desc}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:16}}>
              <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Your Vote</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
                {choices.map((c, i) => (
                  <div key={i} onClick={() => setSelectedChoice(i)}
                    style={{padding:"10px",textAlign:"center",fontSize:"0.8125rem",fontWeight:600,borderRadius:8,cursor:"pointer",transition:"all 0.15s",
                      background: selectedChoice === i ? (i===0?"rgba(52,211,153,0.12)":i===1?"rgba(248,113,113,0.12)":i===3?"rgba(251,191,36,0.12)":"rgba(255,255,255,0.06)") : "rgba(255,255,255,0.02)",
                      border: selectedChoice === i ? (i===0?"1px solid rgba(52,211,153,0.3)":i===1?"1px solid rgba(248,113,113,0.3)":i===3?"1px solid rgba(251,191,36,0.3)":"1px solid rgba(255,255,255,0.1)") : "1px solid rgba(255,255,255,0.04)",
                      color: selectedChoice === i ? (i===0?"#34d399":i===1?"#f87171":i===3?"#fbbf24":"#e5e5e5") : "rgba(255,255,255,0.4)"}}>
                    {c}
                  </div>
                ))}
              </div>
              <div style={{marginTop:10}}>
                <label style={{display:"block",fontSize:"0.6875rem",fontWeight:600,color:"rgba(255,255,255,0.25)",marginBottom:6,textTransform:"uppercase"}}>Stake Weight</label>
                <input value={stakeWeight} onChange={e => setStakeWeight(e.target.value)} style={{width:"100%",padding:"10px 14px",fontFamily:"monospace",fontSize:"0.875rem",color:"#e5e5e5",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,outline:"none"}}/>
              </div>
            </div>
          </div>
          <div>
            <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.25)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>MPC Ballot Verification</div>
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:12,padding:24,minHeight:300}}>
              {status === "idle" && !voteResult && (
                <div style={{textAlign:"center",paddingTop:40}}>
                  <div style={{fontSize:"2.5rem",marginBottom:16}}>🗳️</div>
                  <div style={{fontSize:"0.9375rem",fontWeight:600,marginBottom:6}}>Ready to cast</div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",marginBottom:20}}>
                    <strong style={{color:"#34d399"}}>{choices[selectedChoice]}</strong> on "{proposals[selectedProposal].title}" with {stakeWeight} weight
                  </div>
                  <div style={{fontSize:"0.6875rem",color:"rgba(255,255,255,0.2)",marginBottom:20}}>Real Rescue cipher encryption → Arcium MPC → BLS callback</div>
                  <button onClick={submitBallot} style={{width:"100%",background:"linear-gradient(135deg,#059669,#34d399)",color:"#0a0f0a",border:"none",padding:"14px",borderRadius:8,fontWeight:700,fontSize:"0.875rem",cursor:"pointer"}}>Submit Encrypted Ballot</button>
                </div>
              )}
              {(status === "encrypting" || status === "computing") && (
                <div style={{paddingTop:40}}>
                  <div style={{width:"100%",height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden",margin:"16px 0"}}>
                    <div style={{height:"100%",background:"linear-gradient(90deg,#059669,#34d399)",borderRadius:2,transition:"width 0.5s",width:`${progress}%`}}/>
                  </div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)",textAlign:"center"}}>{chainMsg}</div>
                </div>
              )}
              {status === "error" && (
                <div style={{textAlign:"center",paddingTop:40}}>
                  <div style={{fontSize:"0.875rem",color:"#f87171",marginBottom:12}}>{errorMsg}</div>
                  <button onClick={reset} style={{background:"rgba(255,255,255,0.04)",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.08)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Try Again</button>
                </div>
              )}
              {voteResult && (
                <div style={{textAlign:"center",paddingTop:30}}>
                  <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(52,211,153,0.1)",color:"#34d399",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:"1.5rem"}}>✓</div>
                  <div style={{fontSize:"0.6875rem",fontWeight:700,color:"#34d399",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Ballot Verified via MPC</div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)",marginBottom:4}}>Computation finalized on Solana</div>
                  <div style={{fontSize:"0.75rem",marginBottom:20}}>
                    <a href={`https://explorer.solana.com/tx/${voteResult.txSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{color:"#34d399",fontFamily:"monospace"}}>{shorten(voteResult.txSig)} ↗</a>
                  </div>
                  <button onClick={reset} style={{background:"rgba(255,255,255,0.04)",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.08)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Cast Another Ballot</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
    </div>
  );
}
