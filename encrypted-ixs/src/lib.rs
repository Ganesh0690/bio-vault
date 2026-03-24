use arcis::*;

#[encrypted]
mod circuits {
    use arcis::*;

    pub struct AuthInput {
        template_hash: u128,
        live_scan: u128,
        threshold: u128,
    }

    pub struct AuthResult {
        authenticated: u8,
        score: u128,
    }

    #[instruction]
    pub fn authenticate(input: Enc<Shared, AuthInput>) -> Enc<Shared, AuthResult> {
        let d = input.to_arcis();
        let diff = if d.template_hash > d.live_scan {
            d.template_hash - d.live_scan
        } else {
            d.live_scan - d.template_hash
        };
        let is_match = diff < d.threshold;
        let valid = d.template_hash != 0 && d.live_scan != 0;
        let authenticated: u8 = if is_match && valid { 1 } else { 0 };
        let score: u128 = if is_match && valid { d.threshold - diff } else { 0 };
        let result = AuthResult { authenticated, score };
        input.owner.from_arcis(result)
    }
}
