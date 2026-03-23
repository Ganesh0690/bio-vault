# PrivateMatch - Private Friend Discovery on Solana

Find mutual contacts without revealing non-matches. Powered by Arcium MPC. Real end-to-end computation.

Live Demo: https://private-match.vercel.app
Program ID: 3pVYFr4wuYy15Y32AqLYKiZ987sdzW3TmZaeAMjvdZrt (Solana Devnet)

## Real MPC Flow

- RescueCipher.encrypt: Encrypts contact hashes via x25519 ECDH
- queue_computation: Submits to Arcium MPC via Solana program
- awaitComputationFinalization: Waits for ARX nodes callback

## Tech Stack

Solana - Arcium - Arcis - Anchor 0.32.1 - React + Vite - Arcium Client SDK

## License

MIT
