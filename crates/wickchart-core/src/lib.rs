//! wickchart-core — the WASM compute half of wick-charts.
//!
//! Rendering (Canvas2D) stays in TypeScript. This crate owns the numeric
//! hot paths that actually benefit from running outside the JS interpreter:
//! domain→pixel scaling over large series. Deliberately just the charting
//! engine's own compute, not indicator math — see the project README's
//! "Indicators" note for why that's scoped to consuming applications
//! rather than this library.

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
}
