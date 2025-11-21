use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use warp::{http::StatusCode, Filter, Rejection, Reply};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttestationPayload {
    platform: String,
    integrity_token: String,
    device_key: String,
    nonce: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationResult {
    success: bool,
    trust_score: f32,
    issued_at: u64,
}

#[tokio::main]
async fn main() {
    let verify_route = warp::path("verify")
        .and(warp::post())
        .and(warp::body::json())
        .and_then(handle_verify);

    println!("Attestation verifier listening on 0.0.0.0:3000");
    warp::serve(verify_route).run(([0, 0, 0, 0], 3000)).await;
}

async fn handle_verify(payload: AttestationPayload) -> Result<impl Reply, Rejection> {
    println!(
        "Received attestation payload: platform={}, device_key={}",
        payload.platform,
        payload.device_key
    );

    let response = VerificationResult {
        success: true,
        trust_score: 1.0,
        issued_at: current_timestamp(),
    };

    Ok(warp::reply::with_status(
        warp::reply::json(&response),
        StatusCode::OK,
    ))
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_secs()
}
