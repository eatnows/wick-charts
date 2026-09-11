//! cinderchart-core — the WASM compute half of cinderchart.
//!
//! Rendering (Canvas2D) stays in TypeScript. This crate owns the numeric
//! hot paths that actually benefit from running outside the JS interpreter:
//! domain→pixel scaling over large series, and indicator math.

use wasm_bindgen::prelude::*;

/// Linear mapping from a data domain (e.g. price min/max) to a pixel range
/// (e.g. canvas top/bottom). Every plotted point on every frame goes through
/// this — the classic case where avoiding per-call JS overhead across
/// thousands of points actually shows up in a profile.
#[wasm_bindgen]
pub struct Scale {
    domain_min: f64,
    domain_max: f64,
    range_min: f64,
    range_max: f64,
}

#[wasm_bindgen]
impl Scale {
    #[wasm_bindgen(constructor)]
    pub fn new(domain_min: f64, domain_max: f64, range_min: f64, range_max: f64) -> Scale {
        Scale { domain_min, domain_max, range_min, range_max }
    }

    /// Maps a single value from the data domain into the pixel range.
    pub fn map(&self, value: f64) -> f64 {
        let span = self.domain_max - self.domain_min;
        if span == 0.0 {
            return self.range_min;
        }
        let t = (value - self.domain_min) / span;
        self.range_min + t * (self.range_max - self.range_min)
    }

    /// Maps a whole series in one call, avoiding per-point JS↔WASM boundary
    /// crossings. `values` and the returned buffer are both flat f64 arrays.
    pub fn map_many(&self, values: &[f64]) -> Vec<f64> {
        values.iter().map(|v| self.map(*v)).collect()
    }
}

/// Simple moving average over `closes`, window size `period`. Returns a
/// vector the same length as `closes`, with `NaN` for indices before the
/// first full window so the caller can decide how to render the warm-up
/// region instead of the values being silently shorter than the input.
#[wasm_bindgen]
pub fn sma(closes: &[f64], period: usize) -> Vec<f64> {
    if period == 0 || closes.len() < period {
        return vec![f64::NAN; closes.len()];
    }

    let mut out = Vec::with_capacity(closes.len());
    let mut window_sum = 0.0;

    for (i, &close) in closes.iter().enumerate() {
        window_sum += close;
        if i >= period {
            window_sum -= closes[i - period];
        }
        if i + 1 < period {
            out.push(f64::NAN);
        } else {
            out.push(window_sum / period as f64);
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scale_maps_domain_edges_to_range_edges() {
        let scale = Scale::new(0.0, 100.0, 400.0, 0.0);
        assert_eq!(scale.map(0.0), 400.0);
        assert_eq!(scale.map(100.0), 0.0);
        assert_eq!(scale.map(50.0), 200.0);
    }

    #[test]
    fn sma_warms_up_then_averages() {
        let closes = [1.0, 2.0, 3.0, 4.0, 5.0];
        let out = sma(&closes, 3);
        assert!(out[0].is_nan());
        assert!(out[1].is_nan());
        assert_eq!(out[2], 2.0); // (1+2+3)/3
        assert_eq!(out[3], 3.0); // (2+3+4)/3
        assert_eq!(out[4], 4.0); // (3+4+5)/3
    }
}
