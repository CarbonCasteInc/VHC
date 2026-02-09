//! Attestation Verifier — DEV-ONLY stub.
//!
//! **WARNING**: This service is a development-environment stub and does NOT
//! provide production-grade sybil defense.  All responses are truth-labeled
//! with `environment: "DEV"` and an explicit disclaimer.  Do not deploy to
//! production without replacing the stub verification logic.

use std::convert::Infallible;
use std::env;
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use warp::{http::StatusCode, Filter, Rejection, Reply};

// ── constants ──────────────────────────────────────────────────────────

/// Hard-coded environment posture.  In Wave 1 this is always `"DEV"`.
const ENV_POSTURE: &str = "DEV";

/// Human-readable disclaimer attached to every successful response.
const DEV_DISCLAIMER: &str =
    "DEV-ONLY: this attestation is a stub and does not provide production sybil defense";

/// Maximum accepted length for `nonce` (hex-encoded 32-byte value).
const MAX_NONCE_LEN: usize = 256;

/// Maximum accepted length for `device_key`.
const MAX_DEVICE_KEY_LEN: usize = 512;

/// Maximum accepted length for `integrity_token`.
const MAX_INTEGRITY_TOKEN_LEN: usize = 4096;

// ── request / response types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttestationPayload {
    platform: Platform,
    integrity_token: String,
    device_key: String,
    nonce: String,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Platform {
    Ios,
    Android,
    Web,
}

impl fmt::Display for Platform {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Platform::Ios => write!(f, "ios"),
            Platform::Android => write!(f, "android"),
            Platform::Web => write!(f, "web"),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    token: String,
    trust_score: f32,
    nullifier: String,
    /// Always `"DEV"` in Wave 1.
    environment: String,
    /// Human-readable truth label.
    disclaimer: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    status: &'static str,
    environment: &'static str,
    disclaimer: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    success: bool,
    error: String,
    error_code: String,
    environment: &'static str,
}

// ── rejection type ─────────────────────────────────────────────────────

#[derive(Debug)]
struct BadRequest {
    message: &'static str,
    code: &'static str,
}

impl BadRequest {
    const fn new(message: &'static str, code: &'static str) -> Self {
        Self { message, code }
    }
}

impl warp::reject::Reject for BadRequest {}

// ── routes ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let health_route = warp::path("health")
        .and(warp::get())
        .map(|| {
            warp::reply::json(&HealthResponse {
                status: "ok",
                environment: ENV_POSTURE,
                disclaimer: DEV_DISCLAIMER,
            })
        });

    let verify_route = warp::path("verify")
        .and(warp::post())
        .and(warp::header::optional::<String>("x-mock-attestation"))
        .and(warp::body::json())
        .and_then(handle_verify);

    let routes = health_route
        .or(verify_route)
        .recover(handle_rejection);

    eprintln!(
        "[{ENV_POSTURE}] Attestation verifier listening on 0.0.0.0:3000 \
         — {DEV_DISCLAIMER}"
    );
    warp::serve(routes).run(([0, 0, 0, 0], 3000)).await;
}

// ── handler ────────────────────────────────────────────────────────────

async fn handle_verify(
    mock_header: Option<String>,
    payload: AttestationPayload,
) -> Result<impl Reply, Rejection> {
    validate_payload(&payload)?;

    let mock_mode = is_mock_enabled(&mock_header);
    let trust_score = match payload.platform {
        Platform::Web => verify_web(&payload, mock_mode),
        Platform::Ios => verify_apple(&payload, mock_mode),
        Platform::Android => verify_google(&payload, mock_mode),
    };
    let nullifier = derive_nullifier(&payload.device_key);

    let response = SessionResponse {
        token: format!("session-{}", current_timestamp()),
        trust_score,
        nullifier,
        environment: ENV_POSTURE.to_string(),
        disclaimer: DEV_DISCLAIMER.to_string(),
    };

    Ok(warp::reply::with_status(
        warp::reply::json(&response),
        StatusCode::OK,
    ))
}

// ── validation ─────────────────────────────────────────────────────────

fn validate_payload(payload: &AttestationPayload) -> Result<(), Rejection> {
    if payload.integrity_token.trim().is_empty() {
        return Err(warp::reject::custom(BadRequest::new(
            "integrity_token is required and must not be blank",
            "MISSING_INTEGRITY_TOKEN",
        )));
    }
    if payload.integrity_token.len() > MAX_INTEGRITY_TOKEN_LEN {
        return Err(warp::reject::custom(BadRequest::new(
            "integrity_token exceeds maximum allowed length",
            "INTEGRITY_TOKEN_TOO_LONG",
        )));
    }
    if payload.device_key.trim().is_empty() {
        return Err(warp::reject::custom(BadRequest::new(
            "device_key is required and must not be blank",
            "MISSING_DEVICE_KEY",
        )));
    }
    if payload.device_key.len() > MAX_DEVICE_KEY_LEN {
        return Err(warp::reject::custom(BadRequest::new(
            "device_key exceeds maximum allowed length",
            "DEVICE_KEY_TOO_LONG",
        )));
    }
    if payload.nonce.trim().is_empty() {
        return Err(warp::reject::custom(BadRequest::new(
            "nonce is required and must not be blank",
            "MISSING_NONCE",
        )));
    }
    if payload.nonce.len() > MAX_NONCE_LEN {
        return Err(warp::reject::custom(BadRequest::new(
            "nonce exceeds maximum allowed length",
            "NONCE_TOO_LONG",
        )));
    }
    Ok(())
}

// ── mock / env detection ───────────────────────────────────────────────

fn is_mock_enabled(mock_header: &Option<String>) -> bool {
    if let Ok(flag) = env::var("E2E_MODE") {
        if flag == "true" {
            return true;
        }
    }
    mock_header
        .as_ref()
        .map(|v| v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

// ── stub verifiers (DEV-ONLY) ──────────────────────────────────────────

/// DEV-ONLY: length-heuristic stub — not real attestation.
fn verify_web(payload: &AttestationPayload, mock_mode: bool) -> f32 {
    if mock_mode || payload.integrity_token.trim() == "test-token" {
        return 1.0;
    }
    if payload.integrity_token.len() > 8 {
        0.8
    } else {
        0.0
    }
}

/// DEV-ONLY: prefix-check stub — not real Apple attestation.
fn verify_apple(payload: &AttestationPayload, mock_mode: bool) -> f32 {
    if mock_mode {
        return 1.0;
    }
    if payload.integrity_token.starts_with("apple-") {
        1.0
    } else {
        0.5
    }
}

/// DEV-ONLY: prefix-check stub — not real Google attestation.
fn verify_google(payload: &AttestationPayload, mock_mode: bool) -> f32 {
    if mock_mode {
        return 1.0;
    }
    if payload.integrity_token.starts_with("google-") {
        1.0
    } else {
        0.5
    }
}

// ── error handling ─────────────────────────────────────────────────────

async fn handle_rejection(err: Rejection) -> Result<impl Reply, Infallible> {
    if let Some(bad) = err.find::<BadRequest>() {
        let body = warp::reply::json(&ErrorResponse {
            success: false,
            error: bad.message.to_string(),
            error_code: bad.code.to_string(),
            environment: ENV_POSTURE,
        });
        return Ok(warp::reply::with_status(body, StatusCode::BAD_REQUEST));
    }

    // Malformed JSON body (serde parse failure)
    if err.find::<warp::reject::InvalidHeader>().is_some() {
        let body = warp::reply::json(&ErrorResponse {
            success: false,
            error: "invalid request header".to_string(),
            error_code: "INVALID_HEADER".to_string(),
            environment: ENV_POSTURE,
        });
        return Ok(warp::reply::with_status(body, StatusCode::BAD_REQUEST));
    }

    // Catch deserialization errors (bad JSON body)
    if let Some(body_err) = err.find::<warp::reject::MethodNotAllowed>() {
        let body = warp::reply::json(&ErrorResponse {
            success: false,
            error: format!("method not allowed: {body_err}"),
            error_code: "METHOD_NOT_ALLOWED".to_string(),
            environment: ENV_POSTURE,
        });
        return Ok(warp::reply::with_status(
            body,
            StatusCode::METHOD_NOT_ALLOWED,
        ));
    }

    // Fallback
    let body = warp::reply::json(&ErrorResponse {
        success: false,
        error: "internal server error".to_string(),
        error_code: "INTERNAL_ERROR".to_string(),
        environment: ENV_POSTURE,
    });
    Ok(warp::reply::with_status(
        body,
        StatusCode::INTERNAL_SERVER_ERROR,
    ))
}

// ── helpers ────────────────────────────────────────────────────────────

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| std::time::Duration::from_secs(0))
        .as_secs()
}

fn derive_nullifier(device_key: &str) -> String {
    let salt = env::var("NULLIFIER_SALT")
        .unwrap_or_else(|_| "vh-nullifier-salt".to_string());
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(device_key.as_bytes());
    let hash = hasher.finalize();
    format!("nullifier-{:x}", hash)
}

// ── tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use warp::test::request;

    /// Build the full router used in tests (mirrors main()).
    fn test_routes(
    ) -> impl Filter<Extract = (impl Reply,), Error = Infallible> + Clone {
        let health = warp::path("health").and(warp::get()).map(|| {
            warp::reply::json(&HealthResponse {
                status: "ok",
                environment: ENV_POSTURE,
                disclaimer: DEV_DISCLAIMER,
            })
        });

        let verify = warp::path("verify")
            .and(warp::post())
            .and(warp::header::optional::<String>("x-mock-attestation"))
            .and(warp::body::json())
            .and_then(handle_verify);

        health.or(verify).recover(handle_rejection)
    }

    // ── health endpoint ────────────────────────────────────────────

    #[tokio::test]
    async fn health_returns_dev_posture() {
        let routes = test_routes();
        let res = request()
            .method("GET")
            .path("/health")
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let body: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(body["status"], "ok");
        assert_eq!(body["environment"], "DEV");
        assert!(body["disclaimer"]
            .as_str()
            .unwrap()
            .contains("DEV-ONLY"));
    }

    // ── verify: happy path ─────────────────────────────────────────

    #[tokio::test]
    async fn verify_accepts_valid_payload() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "long-enough-token",
            "deviceKey": "dev",
            "nonce": "n1"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: SessionResponse =
            serde_json::from_slice(res.body()).unwrap();
        assert!(parsed.trust_score >= 0.8);
        assert!(parsed.nullifier.starts_with("nullifier-"));
        assert_eq!(parsed.environment, "DEV");
        assert!(parsed.disclaimer.contains("DEV-ONLY"));
    }

    #[tokio::test]
    async fn verify_response_always_has_truth_labels() {
        let routes = test_routes();
        for platform in &["web", "ios", "android"] {
            let body = serde_json::json!({
                "platform": platform,
                "integrityToken": "apple-tok",
                "deviceKey": "dk",
                "nonce": "nn"
            });

            let res = request()
                .method("POST")
                .path("/verify")
                .json(&body)
                .reply(&routes)
                .await;

            assert_eq!(res.status(), StatusCode::OK);
            let v: serde_json::Value =
                serde_json::from_slice(res.body()).unwrap();
            assert_eq!(
                v["environment"], "DEV",
                "missing DEV label for {platform}"
            );
            assert!(
                v["disclaimer"]
                    .as_str()
                    .unwrap()
                    .contains("DEV-ONLY"),
                "missing disclaimer for {platform}"
            );
        }
    }

    // ── verify: mock header ────────────────────────────────────────

    #[tokio::test]
    async fn verify_honors_mock_header() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "android",
            "integrityToken": "whatever",
            "deviceKey": "dev",
            "nonce": "n1"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .header("x-mock-attestation", "true")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: SessionResponse =
            serde_json::from_slice(res.body()).unwrap();
        assert!((parsed.trust_score - 1.0).abs() < f32::EPSILON);
        assert_eq!(parsed.environment, "DEV");
    }

    // ── verify: validation errors ──────────────────────────────────

    #[tokio::test]
    async fn verify_rejects_blank_integrity_token() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "",
            "deviceKey": "dk",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "MISSING_INTEGRITY_TOKEN");
        assert_eq!(v["environment"], "DEV");
    }

    #[tokio::test]
    async fn verify_rejects_blank_device_key() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "tok",
            "deviceKey": "",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "MISSING_DEVICE_KEY");
    }

    #[tokio::test]
    async fn verify_rejects_blank_nonce() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "tok",
            "deviceKey": "dk",
            "nonce": ""
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "MISSING_NONCE");
    }

    #[tokio::test]
    async fn verify_rejects_oversized_nonce() {
        let routes = test_routes();
        let long_nonce = "x".repeat(MAX_NONCE_LEN + 1);
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "tok",
            "deviceKey": "dk",
            "nonce": long_nonce
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "NONCE_TOO_LONG");
    }

    #[tokio::test]
    async fn verify_rejects_oversized_device_key() {
        let routes = test_routes();
        let long_key = "k".repeat(MAX_DEVICE_KEY_LEN + 1);
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "tok",
            "deviceKey": long_key,
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "DEVICE_KEY_TOO_LONG");
    }

    #[tokio::test]
    async fn verify_rejects_oversized_integrity_token() {
        let routes = test_routes();
        let long_tok = "t".repeat(MAX_INTEGRITY_TOKEN_LEN + 1);
        let body = serde_json::json!({
            "platform": "ios",
            "integrityToken": long_tok,
            "deviceKey": "dk",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::BAD_REQUEST);
        let v: serde_json::Value =
            serde_json::from_slice(res.body()).unwrap();
        assert_eq!(v["errorCode"], "INTEGRITY_TOKEN_TOO_LONG");
    }

    // ── verify: platform-specific stubs ────────────────────────────

    #[tokio::test]
    async fn verify_ios_with_apple_prefix() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "ios",
            "integrityToken": "apple-xyz",
            "deviceKey": "dk",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: SessionResponse =
            serde_json::from_slice(res.body()).unwrap();
        assert!((parsed.trust_score - 1.0).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn verify_android_with_google_prefix() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "android",
            "integrityToken": "google-xyz",
            "deviceKey": "dk",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: SessionResponse =
            serde_json::from_slice(res.body()).unwrap();
        assert!((parsed.trust_score - 1.0).abs() < f32::EPSILON);
    }

    #[tokio::test]
    async fn verify_web_short_token_scores_zero() {
        let routes = test_routes();
        let body = serde_json::json!({
            "platform": "web",
            "integrityToken": "short",
            "deviceKey": "dk",
            "nonce": "nn"
        });

        let res = request()
            .method("POST")
            .path("/verify")
            .json(&body)
            .reply(&routes)
            .await;

        assert_eq!(res.status(), StatusCode::OK);
        let parsed: SessionResponse =
            serde_json::from_slice(res.body()).unwrap();
        assert!(parsed.trust_score.abs() < f32::EPSILON);
    }

    // ── nullifier stability ────────────────────────────────────────

    #[test]
    fn derive_nullifier_is_stable() {
        let n1 = derive_nullifier("device-key-123");
        let n2 = derive_nullifier("device-key-123");
        let n3 = derive_nullifier("device-key-abc");
        assert_eq!(n1, n2);
        assert_ne!(n1, n3);
        assert!(n1.starts_with("nullifier-"));
    }

    // ── unit: is_mock_enabled ──────────────────────────────────────

    #[test]
    fn mock_disabled_by_default() {
        assert!(!is_mock_enabled(&None));
        assert!(!is_mock_enabled(&Some("false".to_string())));
    }

    #[test]
    fn mock_enabled_via_header() {
        assert!(is_mock_enabled(&Some("true".to_string())));
        assert!(is_mock_enabled(&Some("TRUE".to_string())));
    }

    // ── unit: Platform display ─────────────────────────────────────

    #[test]
    fn platform_display() {
        assert_eq!(Platform::Ios.to_string(), "ios");
        assert_eq!(Platform::Android.to_string(), "android");
        assert_eq!(Platform::Web.to_string(), "web");
    }

    // ── constants sanity ───────────────────────────────────────────

    #[test]
    fn env_posture_is_dev() {
        assert_eq!(ENV_POSTURE, "DEV");
    }

    #[test]
    fn disclaimer_contains_dev_only() {
        assert!(DEV_DISCLAIMER.contains("DEV-ONLY"));
        assert!(DEV_DISCLAIMER.contains("not"));
        assert!(DEV_DISCLAIMER.contains("production"));
    }
}
