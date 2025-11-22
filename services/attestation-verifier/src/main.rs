use std::convert::Infallible;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use warp::{http::StatusCode, Filter, Rejection, Reply};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttestationPayload {
    platform: Platform,
    integrity_token: String,
    device_key: String,
    nonce: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Platform {
    Ios,
    Android,
    Web,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationResult {
    success: bool,
    trust_score: f32,
    issued_at: u64,
}

#[derive(Debug)]
struct BadRequest(&'static str);

impl warp::reject::Reject for BadRequest {}

#[tokio::main]
async fn main() {
    let verify_route = warp::path("verify")
        .and(warp::post())
        .and(warp::body::json())
        .and_then(handle_verify)
        .recover(handle_rejection);

    println!("Attestation verifier listening on 0.0.0.0:3000");
    warp::serve(verify_route).run(([0, 0, 0, 0], 3000)).await;
}

async fn handle_verify(payload: AttestationPayload) -> Result<impl Reply, Rejection> {
    validate_payload(&payload).map_err(|e| warp::reject::custom(e))?;

    // Stubbed trust calculation: if integrity token is non-empty we consider it fully trusted
    let trust_score = if payload.integrity_token.trim().is_empty() {
        0.0
    } else {
        1.0
    };

    let response = VerificationResult {
        success: trust_score >= 0.5,
        trust_score,
        issued_at: current_timestamp(),
    };

    Ok(warp::reply::with_status(
        warp::reply::json(&response),
        StatusCode::OK,
    ))
}

fn validate_payload(payload: &AttestationPayload) -> Result<(), BadRequest> {
    if payload.integrity_token.trim().is_empty() {
        return Err(BadRequest("integrity_token required"));
    }
    if payload.device_key.trim().is_empty() {
        return Err(BadRequest("device_key required"));
    }
    if payload.nonce.trim().is_empty() {
        return Err(BadRequest("nonce required"));
    }
    match payload.platform {
        Platform::Ios | Platform::Android | Platform::Web => Ok(()),
    }
}

async fn handle_rejection(err: Rejection) -> Result<impl Reply, Infallible> {
    if let Some(BadRequest(msg)) = err.find() {
        let body = warp::reply::json(&serde_json::json!({
            "success": false,
            "error": msg
        }));
        return Ok(warp::reply::with_status(body, StatusCode::BAD_REQUEST));
    }

    let body = warp::reply::json(&serde_json::json!({
        "success": false,
        "error": "internal_error"
    }));
    Ok(warp::reply::with_status(body, StatusCode::INTERNAL_SERVER_ERROR))
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use warp::test::request;

    #[tokio::test]
    async fn verify_accepts_valid_payload() {
        let filter = warp::path("verify")
            .and(warp::post())
            .and(warp::body::json())
            .and_then(handle_verify)
            .recover(handle_rejection);

        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "token",
            "deviceKey": "dev",
            "nonce": "n1"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&filter)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: VerificationResult = serde_json::from_slice(res.body()).unwrap();
        assert!(parsed.success);
        assert!(parsed.trust_score >= 0.5);
    }

    #[tokio::test]
    async fn verify_rejects_missing_fields() {
        let filter = warp::path("verify")
            .and(warp::post())
            .and(warp::body::json())
            .and_then(handle_verify)
            .recover(handle_rejection);

        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "",
            "deviceKey": "",
            "nonce": ""
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&filter)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
    }
}
