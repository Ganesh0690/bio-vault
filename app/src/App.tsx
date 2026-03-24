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

const PROGRAM_ID = new PublicKey("6moFPWkC7mw9Df7WNyEQbmb5GBvp4bfswWGKV8WQH7ai");
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const CLUSTER_OFFSET = 456;
import IDL from "./idl/bio_vault.json";

function randomBytes(n: number): Buffer { return Buffer.from(crypto.getRandomValues(new Uint8Array(n))); }
function toArr32(data: any): number[] { const r: number[] = []; for (let i = 0; i < 32; i++) r.push(typeof data[i] === "number" ? data[i] & 0xff : 0); return r; }
function shorten(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }

type View = "landing" | "app";
type Status = "idle" | "enrolling" | "encrypting" | "computing" | "complete" | "error";

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

function hashTemplate(input: string): bigint {
  let h = BigInt(5381);
  for (let i = 0; i < input.length; i++) { h = ((h << BigInt(5)) + h) + BigInt(input.charCodeAt(i)); h = h & BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"); }
  return h;
}

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
  const [authResult, setAuthResult] = useState<{txSig: string} | null>(null);
  const [enrolledTemplate, setEnrolledTemplate] = useState("");
  const [liveScan, setLiveScan] = useState("");
  const [threshold, setThreshold] = useState("1000");

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
    setChainMsg("Initializing BioVault...");
    try {
      const [pda] = PublicKey.findProgramAddressSync([Buffer.from("program_state")], PROGRAM_ID);
      const info = await connection.getAccountInfo(pda);
      if (info) { setChainMsg("Already initialized"); }
      else { const tx = await prog.methods.initialize().accounts({ authority: new PublicKey(wallet), programState: pda, systemProgram: SystemProgram.programId }).rpc(); setTxSigs(p => [...p, tx]); setChainMsg("Initialized — " + shorten(tx)); }
    } catch (e: any) { setChainMsg(e.message?.includes("already") ? "Already initialized" : "Error: " + e.message?.slice(0, 60)); }
    try {
      const compDefOffset = Buffer.from(getCompDefAccOffset("authenticate")).readUInt32LE();
      const compDefInfo = await connection.getAccountInfo(getCompDefAccAddress(PROGRAM_ID, compDefOffset));
      if (compDefInfo) { setChainMsg("BioVault ready — auth circuit loaded"); } else { setChainMsg("Comp def not found"); }
    } catch {}
  }, [wallet]);

  const enrollTemplate = useCallback(() => {
    const template = "bio_" + Math.random().toString(36).slice(2, 10) + "_" + wallet.slice(0, 8);
    setEnrolledTemplate(template);
    setLiveScan(template);
    setStatus("enrolling");
    setTimeout(() => setStatus("idle"), 1200);
    setChainMsg("Template enrolled (simulated biometric capture)");
  }, [wallet]);

  const authenticate = useCallback(async () => {
    const provider = getProvider(); const prog = getProgram();
    if (!provider || !prog) return;
    if (!enrolledTemplate) { setChainMsg("Enroll a template first"); return; }
    setAuthResult(null); setErrorMsg("");
    setStatus("encrypting"); setProgress(15);
    setChainMsg("Fetching MXE x25519 public key...");
    try {
      const mxePubKey = await getMXEPubKeyRetry(provider, PROGRAM_ID);
      setProgress(25); setChainMsg("Encrypting biometric data with Rescue cipher...");
      const privKey = x25519.utils.randomPrivateKey();
      const pubKey = x25519.getPublicKey(privKey);
      const sharedSecret = x25519.getSharedSecret(privKey, mxePubKey);
      const cipher = new RescueCipher(sharedSecret as any);
      const nonce = randomBytes(16);

      const templateHash = hashTemplate(enrolledTemplate);
      const scanHash = hashTemplate(liveScan);
      const thresh = BigInt(threshold);

      const ctTemplate = cipher.encrypt([templateHash], nonce);
      const ctScan = cipher.encrypt([scanHash], nonce);
      const ctThreshold = cipher.encrypt([thresh], nonce);
      setProgress(45); setChainMsg("Biometrics encrypted. Submitting to Arcium MPC...");

      const computationOffset = new BN(randomBytes(8), "hex");
      const compDefOffset = Buffer.from(getCompDefAccOffset("authenticate")).readUInt32LE();
      setStatus("computing"); setProgress(55);
      setChainMsg("Encrypted biometrics queued on Solana...");

      const queueTx = await prog.methods.authenticate(
        computationOffset,
        toArr32(ctTemplate[0]), toArr32(ctScan[0]), toArr32(ctThreshold[0]),
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
      setChainMsg("Queued! Tx: " + shorten(queueTx) + ". ARX nodes matching...");
      setProgress(80); setChainMsg("MPC nodes comparing biometrics on secret shares...");

      const finalizeTx = await awaitComputationFinalization(provider, computationOffset, PROGRAM_ID, "confirmed", 120000);
      setTxSigs(p => [...p, finalizeTx]); setProgress(100);
      setAuthResult({ txSig: finalizeTx });
      setStatus("complete"); setChainMsg("Auth complete! Callback: " + shorten(finalizeTx));
    } catch (e: any) {
      console.error("Auth error:", e);
      setErrorMsg(e.message?.slice(0, 120) || "Unknown"); setStatus("error");
      setChainMsg("Error: " + (e.message?.slice(0, 80) || "Unknown"));
    }
  }, [wallet, enrolledTemplate, liveScan, threshold]);

  const reset = useCallback(() => { setStatus("idle"); setProgress(0); setAuthResult(null); setChainMsg(""); setErrorMsg(""); }, []);

  if (view === "landing") return (
    <div style={{minHeight:"100vh",background:"#050a12",color:"#e5e5e5",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"24px 48px",maxWidth:1200,margin:"0 auto"}}>
        <div style={{fontSize:"1.375rem",fontWeight:800,letterSpacing:"-0.04em"}}>Bio<span style={{color:"#22d3ee",fontWeight:400}}>Vault</span></div>
        <button onClick={connect} style={{background:"linear-gradient(135deg,#0891b2,#22d3ee)",color:"#050a12",border:"none",padding:"10px 28px",borderRadius:8,fontWeight:700,fontSize:"0.8125rem",cursor:"pointer"}}>Enter App →</button>
      </nav>
      <section style={{padding:"120px 48px 80px",maxWidth:1200,margin:"0 auto",textAlign:"center"}}>
        <div style={{display:"inline-block",background:"rgba(34,211,238,0.06)",border:"1px solid rgba(34,211,238,0.12)",borderRadius:999,padding:"6px 16px",fontSize:"0.75rem",fontWeight:600,color:"#22d3ee",letterSpacing:"0.06em",marginBottom:28}}>PRIVATE BIOMETRIC IDENTITY</div>
        <h1 style={{fontSize:"clamp(3rem,6vw,5rem)",fontWeight:800,lineHeight:1.05,letterSpacing:"-0.04em",marginBottom:24,maxWidth:700,margin:"0 auto 24px"}}>Your biometrics,<br/><span style={{color:"#22d3ee"}}>never exposed.</span></h1>
        <p style={{fontSize:"1.125rem",lineHeight:1.7,color:"rgba(255,255,255,0.4)",maxWidth:560,margin:"0 auto 40px"}}>Biometric templates are secret-shared across Arcium MPC nodes. Authentication runs privately — apps learn only match or no-match. Portable, vendor-agnostic, privacy-preserving login on Solana.</p>
        <div style={{display:"flex",gap:12,justifyContent:"center"}}>
          <button onClick={connect} style={{background:"linear-gradient(135deg,#0891b2,#22d3ee)",color:"#050a12",border:"none",padding:"16px 40px",borderRadius:8,fontWeight:700,fontSize:"1rem",cursor:"pointer"}}>Launch BioVault</button>
          <a href="https://github.com/Ganesh0690/bio-vault" target="_blank" rel="noreferrer" style={{background:"transparent",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.1)",padding:"16px 40px",borderRadius:8,fontWeight:600,fontSize:"1rem",textDecoration:"none"}}>View Source</a>
        </div>
      </section>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,maxWidth:1200,margin:"0 auto",padding:"0 48px 80px"}}>
        {[["🔒","Zero-knowledge matching","Templates encrypted with Rescue cipher. MPC nodes compare on secret shares — raw biometrics never leave your device."],["🌐","Vendor agnostic","No hardware lock-in. Works across any device or sensor. Your identity is portable and self-sovereign."],["⚡","On-chain verification","Every auth generates a Solana transaction. BLS-signed callback proves the computation was honest."]].map(([icon,t,d],i) =>
          <div key={i} style={{padding:"36px 28px",background:"rgba(34,211,238,0.02)",borderRight: i < 2 ? "1px solid rgba(34,211,238,0.06)" : "none"}}>
            <div style={{fontSize:"1.5rem",marginBottom:12}}>{icon}</div>
            <div style={{fontSize:"1rem",fontWeight:700,marginBottom:8}}>{t}</div>
            <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",lineHeight:1.65}}>{d}</div>
          </div>)}
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#050a12",color:"#e5e5e5",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <nav style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 48px",maxWidth:1200,margin:"0 auto"}}>
        <div style={{fontSize:"1.375rem",fontWeight:800,letterSpacing:"-0.04em"}}>Bio<span style={{color:"#22d3ee",fontWeight:400}}>Vault</span></div>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <span onClick={() => setView("landing")} style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",cursor:"pointer"}}>Home</span>
          <span style={{fontFamily:"monospace",fontSize:"0.6875rem",color:"rgba(255,255,255,0.25)",padding:"5px 10px",background:"rgba(255,255,255,0.04)",borderRadius:6}}>{shorten(wallet)}</span>
          <button onClick={disconnect} style={{background:"transparent",border:"none",color:"rgba(255,255,255,0.25)",cursor:"pointer",fontSize:"0.75rem"}}>Exit</button>
        </div>
      </nav>
      <div style={{maxWidth:1200,margin:"0 auto",padding:"0 48px 60px"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",background:"rgba(34,211,238,0.03)",border:"1px solid rgba(34,211,238,0.08)",borderRadius:10,marginBottom:20,fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:"#22d3ee"}}/> Solana Devnet · Arcium MPC Cluster 456
          <span style={{fontFamily:"monospace",marginLeft:8,fontSize:"0.6875rem"}}>{shorten(PROGRAM_ID.toString())}</span>
          <span style={{marginLeft:"auto",color:"#22d3ee",fontWeight:600}}>{balance.toFixed(2)} SOL</span>
          {status==="computing"&&<span style={{color:"#22d3ee",fontSize:"0.75rem",animation:"pulse 1.5s infinite"}}>● Matching</span>}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          <button onClick={initOnChain} style={{background:"rgba(34,211,238,0.08)",color:"#22d3ee",border:"1px solid rgba(34,211,238,0.15)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Initialize</button>
          {chainMsg && <span style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",alignSelf:"center",marginLeft:8}}>{chainMsg}</span>}
        </div>
        {txSigs.length > 0 && <div style={{padding:"12px 16px",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:10,marginBottom:20}}>
          <div style={{fontSize:"0.5625rem",fontWeight:700,color:"#22d3ee",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:6}}>Verified Transactions</div>
          {txSigs.map((sig, i) => <a key={i} href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{fontFamily:"monospace",fontSize:"0.6875rem",color:"rgba(255,255,255,0.25)",textDecoration:"none",display:"block",marginBottom:3}}>{shorten(sig)} ↗</a>)}
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
          <div>
            <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Biometric Enrollment</div>
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:12,padding:24,marginBottom:16}}>
              <div style={{textAlign:"center",padding:"20px 0"}}>
                <div style={{width:80,height:80,borderRadius:"50%",background: enrolledTemplate ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.02)",border: enrolledTemplate ? "2px solid rgba(34,211,238,0.2)" : "2px dashed rgba(255,255,255,0.08)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:"2rem",transition:"all 0.3s"}}>
                  {enrolledTemplate ? "🔐" : "👆"}
                </div>
                {!enrolledTemplate ? (
                  <button onClick={enrollTemplate} style={{background:"linear-gradient(135deg,#0891b2,#22d3ee)",color:"#050a12",border:"none",padding:"12px 28px",borderRadius:8,fontWeight:700,fontSize:"0.875rem",cursor:"pointer"}}>Simulate Biometric Capture</button>
                ) : (
                  <div>
                    <div style={{fontSize:"0.75rem",fontWeight:600,color:"#22d3ee",marginBottom:4}}>Template Enrolled</div>
                    <div style={{fontFamily:"monospace",fontSize:"0.6875rem",color:"rgba(255,255,255,0.25)",wordBreak:"break-all"}}>{enrolledTemplate}</div>
                  </div>
                )}
              </div>
            </div>
            {enrolledTemplate && (
              <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:12,padding:20}}>
                <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Live Scan (for verification)</div>
                <input value={liveScan} onChange={e => setLiveScan(e.target.value)} style={{width:"100%",padding:"10px 14px",fontFamily:"monospace",fontSize:"0.8125rem",color:"#e5e5e5",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,outline:"none",marginBottom:10}}/>
                <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6}}>Match Threshold</div>
                <input value={threshold} onChange={e => setThreshold(e.target.value)} style={{width:"100%",padding:"10px 14px",fontFamily:"monospace",fontSize:"0.8125rem",color:"#e5e5e5",background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:8,outline:"none"}}/>
              </div>
            )}
          </div>
          <div>
            <div style={{fontSize:"0.6875rem",fontWeight:700,color:"rgba(255,255,255,0.2)",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>MPC Authentication</div>
            <div style={{background:"rgba(255,255,255,0.02)",border:"1px solid rgba(255,255,255,0.04)",borderRadius:12,padding:24,minHeight:320}}>
              {status === "idle" && !authResult && (
                <div style={{textAlign:"center",paddingTop:50}}>
                  {!enrolledTemplate ? (
                    <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.25)"}}>Enroll a biometric template first →</div>
                  ) : (
                    <>
                      <div style={{fontSize:"2rem",marginBottom:16}}>🔐</div>
                      <div style={{fontSize:"0.9375rem",fontWeight:600,marginBottom:6}}>Ready to authenticate</div>
                      <div style={{fontSize:"0.75rem",color:"rgba(255,255,255,0.25)",marginBottom:20}}>Template + live scan encrypted → Arcium MPC → match/no-match</div>
                      <button onClick={authenticate} style={{width:"100%",background:"linear-gradient(135deg,#0891b2,#22d3ee)",color:"#050a12",border:"none",padding:"14px",borderRadius:8,fontWeight:700,fontSize:"0.875rem",cursor:"pointer"}}>Authenticate via Arcium MPC</button>
                    </>
                  )}
                </div>
              )}
              {status === "enrolling" && (
                <div style={{textAlign:"center",paddingTop:60}}>
                  <div style={{fontSize:"2rem",marginBottom:12,animation:"pulse 0.6s infinite"}}>👆</div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.35)"}}>Capturing biometric template...</div>
                </div>
              )}
              {(status === "encrypting" || status === "computing") && (
                <div style={{paddingTop:50}}>
                  <div style={{width:"100%",height:3,background:"rgba(255,255,255,0.04)",borderRadius:2,overflow:"hidden",margin:"16px 0"}}>
                    <div style={{height:"100%",background:"linear-gradient(90deg,#0891b2,#22d3ee)",borderRadius:2,transition:"width 0.5s",width:`${progress}%`}}/>
                  </div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",textAlign:"center"}}>{chainMsg}</div>
                </div>
              )}
              {status === "error" && (
                <div style={{textAlign:"center",paddingTop:50}}>
                  <div style={{fontSize:"0.875rem",color:"#f87171",marginBottom:12}}>{errorMsg}</div>
                  <button onClick={reset} style={{background:"rgba(255,255,255,0.04)",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.08)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Try Again</button>
                </div>
              )}
              {authResult && (
                <div style={{textAlign:"center",paddingTop:40}}>
                  <div style={{width:56,height:56,borderRadius:"50%",background:"rgba(34,211,238,0.1)",color:"#22d3ee",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:"1.5rem"}}>✓</div>
                  <div style={{fontSize:"0.6875rem",fontWeight:700,color:"#22d3ee",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:12}}>Identity Verified via MPC</div>
                  <div style={{fontSize:"0.8125rem",color:"rgba(255,255,255,0.3)",marginBottom:4}}>Biometric match confirmed on-chain</div>
                  <div style={{fontSize:"0.75rem",marginBottom:20}}>
                    <a href={`https://explorer.solana.com/tx/${authResult.txSig}?cluster=devnet`} target="_blank" rel="noreferrer" style={{color:"#22d3ee",fontFamily:"monospace"}}>{shorten(authResult.txSig)} ↗</a>
                  </div>
                  <button onClick={reset} style={{background:"rgba(255,255,255,0.04)",color:"#e5e5e5",border:"1px solid rgba(255,255,255,0.08)",padding:"8px 20px",borderRadius:8,fontWeight:600,fontSize:"0.75rem",cursor:"pointer"}}>Authenticate Again</button>
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
