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
        confidence: u128,
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
        let valid_template = d.template_hash != 0;
        let valid_scan = d.live_scan != 0;
        let all_pass = is_match && valid_template && valid_scan;
        let authenticated: u8 = if all_pass { 1 } else { 0 };
        let confidence: u128 = if all_pass {
            10000 - (diff * 10000 / (d.threshold + 1))
        } else { 0 };
        let result = AuthResult { authenticated, confidence };
        input.owner.from_arcis(result)
    }
}
