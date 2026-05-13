import { Link } from "react-router-dom";
import { ArrowLeft, Cpu, Activity, Thermometer, Heart, Wind, FileDown, FileText, Loader2 } from "lucide-react";
import logo from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { useVitals } from "@/hooks/useVitals";
import { useMemo, useState } from "react";
import { evaluateHealth, type HealthStatus } from "@/lib/healthLogic";
import { downloadSensorDocumentationWord } from "@/lib/documentationWordExport";

/* ── Correlation helper ── */
function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] - mx, yi = y[i] - my;
    num += xi * yi; dx += xi * xi; dy += yi * yi;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

function corrLabel(r: number) {
  const a = Math.abs(r);
  if (a > 0.7) return "Strong";
  if (a > 0.4) return "Moderate";
  if (a > 0.2) return "Weak";
  return "Negligible";
}

export default function Documentation() {
  const { records } = useVitals();
  const [wordExporting, setWordExporting] = useState(false);

  const stats = useMemo(() => {
    if (!records.length) return null;
    const temps = records.map(r => r.temperature);
    const hrs = records.map(r => r.heart_rate);
    const spo2s = records.map(r => r.spo2);

    const min = (a: number[]) => Math.min(...a);
    const max = (a: number[]) => Math.max(...a);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const classify = (r: { temperature: number; heart_rate: number; spo2: number }) =>
      evaluateHealth({
        temperature: r.temperature,
        heart_rate: r.heart_rate,
        spo2: r.spo2,
      }).status;

    const consistency = records.reduce(
      (acc, r) => {
        const expected = classify(r);
        if ((r.status as HealthStatus) === expected) {
          acc.matched += 1;
        } else {
          acc.mismatched += 1;
        }
        return acc;
      },
      { matched: 0, mismatched: 0 }
    );

    const categorizedSample = records.slice(0, 10).map((r) => {
      const expected = classify(r);
      return {
        id: r.id,
        temperature: r.temperature,
        heart_rate: r.heart_rate,
        spo2: r.spo2,
        stored: r.status as HealthStatus,
        expected,
        isConsistent: (r.status as HealthStatus) === expected,
      };
    });

    // Normalization ranges
    const norm = (vals: number[]) => {
      const lo = min(vals), hi = max(vals);
      return vals.map(v => hi > lo ? (v - lo) / (hi - lo) : 0);
    };

    return {
      total: records.length,
      safe: records.filter(r => r.status === "SAFE").length,
      invalid: records.filter(r => r.status === "INVALID").length,
      observe: records.filter(r => r.status === "OBSERVE").length,
      warning: records.filter(r => r.status === "WARNING").length,
      alert: records.filter(r => r.status === "ALERT").length,
      critical: records.filter(r => r.status === "CRITICAL").length,
      classPct: {
        safe: (records.filter(r => r.status === "SAFE").length / records.length) * 100,
        invalid: (records.filter(r => r.status === "INVALID").length / records.length) * 100,
        observe: (records.filter(r => r.status === "OBSERVE").length / records.length) * 100,
        warning: (records.filter(r => r.status === "WARNING").length / records.length) * 100,
        alert: (records.filter(r => r.status === "ALERT").length / records.length) * 100,
        critical: (records.filter(r => r.status === "CRITICAL").length / records.length) * 100,
      },
      temp: { min: min(temps), max: max(temps), avg: avg(temps) },
      hr: { min: min(hrs), max: max(hrs), avg: avg(hrs) },
      spo2: { min: min(spo2s), max: max(spo2s), avg: avg(spo2s) },
      corr: {
        tempHr: pearson(temps, hrs),
        tempSpo2: pearson(temps, spo2s),
        hrSpo2: pearson(hrs, spo2s),
      },
      normSample: records.slice(0, 5).map((r, i) => ({
        raw: r,
        normTemp: norm(temps)[i],
        normHr: norm(hrs)[i],
        normSpo2: norm(spo2s)[i],
      })),
      consistency,
      categorizedSample,
    };
  }, [records]);

  return (
    <div className="min-h-screen bg-background print:bg-white print:text-foreground">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-card/80 backdrop-blur-md border-b border-border print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src={logo} alt="Logo" className="h-9 w-auto" />
            <span className="font-display font-bold text-foreground">Sick-Bay Kiosk</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              disabled={wordExporting}
              onClick={async () => {
                setWordExporting(true);
                try {
                  await downloadSensorDocumentationWord(stats);
                } catch (e) {
                  console.error("Word export failed:", e);
                } finally {
                  setWordExporting(false);
                }
              }}
            >
              {wordExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileText className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">Download Word</span>
              <span className="sm:hidden">Word</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => window.print()}
            >
              <FileDown className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Save as PDF</span>
              <span className="sm:hidden">PDF</span>
            </Button>
            <Link to="/" className="flex items-center gap-1.5 text-xs text-primary hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" /> Dashboard
            </Link>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8 print:py-6 print:px-6">
        <header className="animate-slide-up">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em] mb-1">
            University of Rwanda · IoT Project
          </p>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground">
            Sensor Data Documentation & Analysis
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-2xl">
            End-to-end technical documentation for how raw signals become clinical indicators, including sensor capture format, translation logic, formula rationale, calibration assumptions, and threshold-based status evaluation.
          </p>
          <p className="mt-3 hidden print:block text-xs text-muted-foreground">
            Generated PDF: use your browser print dialog and select &quot;Save as PDF&quot; (or Microsoft Print to PDF).
          </p>
        </header>

        {/* ─── 1. Sensor Identification ─── */}
        <Section icon={<Cpu />} title="1. Sensor Identification & Hardware">
          <p className="text-sm text-muted-foreground mb-4">
            Each sensor has a distinct physiological target and contributes one part of the final health assessment.
          </p>
          <div className="grid sm:grid-cols-3 gap-4">
            <SensorCard
              name="MAX30205"
              id="SENSOR-TEMP-01"
              type="Temperature"
              protocol="I²C (Inter-Integrated Circuit, 0x48)"
              desc="Human body temperature sensor, ±0.1°C accuracy"
            />
            <SensorCard
              name="MAX30102 (IR: Infrared)"
              id="SENSOR-HR-01"
              type="Heart Rate"
              protocol="I²C (Inter-Integrated Circuit, 0x57)"
              desc="Infrared PPG (Photoplethysmography) channel for pulse detection"
            />
            <SensorCard
              name="MAX30102 (Red)"
              id="SENSOR-SPO2-01"
              type="SpO₂ (Peripheral Oxygen Saturation)"
              protocol="I²C (Inter-Integrated Circuit, 0x57)"
              desc="Red LED channel for blood oxygen estimation"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            The MAX30205 measures skin-contact temperature directly in digital form. The MAX30102 is an optical PPG (Photoplethysmography) sensor: its IR (Infrared) channel is primarily used for pulse timing
            (heart-rate extraction), while the red/IR pair is used for SpO₂ (Peripheral Oxygen Saturation) estimation through relative light absorption differences in pulsatile blood.
          </p>
        </Section>

        {/* ─── 2. Sensor Capture Format & Translation Flow ─── */}
        <Section icon={<Activity />} title="2. Sensor Capture Format & Translation Flow">
          <p className="text-sm text-muted-foreground mb-4">
            Data arrives as time-ordered records and is translated in stages from device-level signals into clinically interpretable values.
          </p>
          <div className="bg-accent/30 rounded-xl p-4 space-y-2 text-xs text-muted-foreground leading-relaxed">
            <p><span className="font-semibold text-foreground">Stored record schema:</span> <span className="font-mono">{"{ id, temperature, heart_rate, spo2, status, recommendation, created_at }"}</span></p>
            <p><span className="font-semibold text-foreground">Type mapping:</span> <span className="font-mono">temperature</span> in °C (float), <span className="font-mono">heart_rate</span> in bpm (beats per minute, integer-like), <span className="font-mono">spo2</span> in % (integer-like), <span className="font-mono">created_at</span> ISO (International Organization for Standardization) timestamp.</p>
            <p><span className="font-semibold text-foreground">Logical translation chain:</span> Sensor sample → signal conditioning/filtering → feature extraction (peaks or AC/DC ratio, where AC is alternating pulsatile component and DC is direct baseline component) → unit conversion formula → threshold rules → final status/recommendation.</p>
            <p><span className="font-semibold text-foreground">Why this matters:</span> separating acquisition, conversion, and decision logic makes the system easier to audit, recalibrate, and validate clinically.</p>
          </div>
        </Section>

        {/* ─── 3. Conversion Formulas ─── */}
        <Section icon={<Activity />} title="3. Data Conversion Formulas & Why They Work">
          <p className="text-sm text-muted-foreground mb-4">
            Raw device outputs are not directly interpretable. These formulas convert hardware-level values into units used by clinicians.
          </p>
          <div className="space-y-4">
            <FormulaCard
              sensor="MAX30205 — Temperature"
              formula="T(°C) = Raw_16bit × 0.00390625"
              explanation="The MAX30205 register is a signed 16-bit value where each LSB (Least Significant Bit) corresponds to 1/256°C. Multiplying by 0.00390625 converts digital code to physical temperature. The formula is derived from sensor resolution, not from empirical fitting, which improves repeatability across devices."
              range="35.0°C — 42.0°C (clinical range)"
            />
            <FormulaCard
              sensor="MAX30102 — Heart Rate"
              formula="HR(bpm) = 60 / avg(peak_intervals_sec)"
              explanation="The IR (Infrared) PPG (Photoplethysmography) signal rises and falls with blood volume change each beat. After smoothing/noise suppression, successive pulse peaks are detected. The average IBI (Inter-Beat Interval) is measured in seconds, and dividing 60 by IBI converts beat period into bpm (beats per minute). This is a timing-based derivation, so accurate peak detection is the critical step."
              range="40 — 200 bpm (physiological range)"
            />
            <FormulaCard
              sensor="MAX30102 — SpO₂"
              formula="SpO₂(%) = 110 - 25 × (R_red_AC/R_red_DC) / (R_ir_AC/R_ir_DC)"
              explanation="SpO₂ (Peripheral Oxygen Saturation) estimation uses a ratio-of-ratios: pulsatile (AC, alternating current-like component) and baseline (DC, direct current-like component) for red and IR (Infrared) channels are compared to form R. Oxygenated and deoxygenated hemoglobin absorb red/IR light differently, so R correlates with oxygen saturation. The linear mapping (110 - 25R) is an empirical approximation and should be treated as calibrated estimation, not invasive-grade blood gas measurement."
              range="70% — 100% (clinical range)"
            />
          </div>
        </Section>

        {/* ─── 4. Calibration ─── */}
        <Section icon={<Thermometer />} title="4. Calibration Reference Values">
          <p className="text-sm text-muted-foreground mb-4">
            Calibration aligns measured values with trusted reference instruments to reduce systematic bias and drift.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-semibold text-foreground">Sensor</th>
                  <th className="py-2 pr-4 font-semibold text-foreground">Reference Instrument</th>
                  <th className="py-2 pr-4 font-semibold text-foreground">Reference Value</th>
                  <th className="py-2 pr-4 font-semibold text-foreground">Offset Applied</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4">MAX30205</td>
                  <td className="py-2 pr-4">Mercury thermometer (±0.1°C)</td>
                  <td className="py-2 pr-4">36.5°C</td>
                  <td className="py-2 pr-4">+0.2°C correction</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4">MAX30102 (HR)</td>
                  <td className="py-2 pr-4">Clinical pulse oximeter (HR reference mode)</td>
                  <td className="py-2 pr-4">72 bpm at rest</td>
                  <td className="py-2 pr-4">±2 bpm tolerance</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">MAX30102 (SpO₂)</td>
                  <td className="py-2 pr-4">Clinical pulse oximeter</td>
                  <td className="py-2 pr-4">98% at rest</td>
                  <td className="py-2 pr-4">±1% tolerance</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Calibration offsets should be reviewed after hardware changes, LED current updates, finger-placement changes, or major ambient lighting differences. Stable calibration is essential
            because downstream classification uses fixed thresholds.
          </p>
        </Section>

        {/* ─── 5. Normalization ─── */}
        <Section icon={<Activity />} title="5. Data Normalization (Min-Max Scaling)">
          <p className="text-sm text-muted-foreground mb-4">
            Min-max normalization rescales features to [0, 1] so parameters with different units can be compared consistently in analytics/visual pipelines.
          </p>
          <div className="bg-accent/50 rounded-xl p-4 mb-4 font-mono text-sm text-foreground">
            X_norm = (X - X_min) / (X_max - X_min)
          </div>
          {stats && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-semibold text-foreground">Parameter</th>
                    <th className="py-2 pr-4 font-semibold text-foreground">Min (X_min)</th>
                    <th className="py-2 pr-4 font-semibold text-foreground">Max (X_max)</th>
                    <th className="py-2 pr-4 font-semibold text-foreground">Mean</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Temperature (°C)</td>
                    <td className="py-2 pr-4">{stats.temp.min.toFixed(1)}</td>
                    <td className="py-2 pr-4">{stats.temp.max.toFixed(1)}</td>
                    <td className="py-2 pr-4">{stats.temp.avg.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-border/50">
                    <td className="py-2 pr-4">Heart Rate (bpm)</td>
                    <td className="py-2 pr-4">{stats.hr.min}</td>
                    <td className="py-2 pr-4">{stats.hr.max}</td>
                    <td className="py-2 pr-4">{stats.hr.avg.toFixed(1)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4">SpO₂ (Peripheral Oxygen Saturation, %)</td>
                    <td className="py-2 pr-4">{stats.spo2.min}</td>
                    <td className="py-2 pr-4">{stats.spo2.max}</td>
                    <td className="py-2 pr-4">{stats.spo2.avg.toFixed(1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Note: in this dashboard, final INVALID/SAFE/OBSERVE/WARNING/ALERT/CRITICAL decisions are threshold-based on native units (°C, bpm, %). Normalization is used for analysis comparability and model-ready preprocessing, not to replace clinical thresholds.
          </p>
        </Section>

        {/* ─── 6. Correlation ─── */}
        <Section icon={<Heart />} title="6. Sensor Data Correlation Analysis">
          <p className="text-sm text-muted-foreground mb-4">
            Pearson correlation coefficients between sensor readings (computed from {stats?.total ?? 0} records):
          </p>
          {stats && (
            <>
              <div className="grid sm:grid-cols-3 gap-4 mb-4">
                <CorrCard a="Temp" b="HR" r={stats.corr.tempHr} />
                <CorrCard a="Temp" b="SpO₂" r={stats.corr.tempSpo2} />
                <CorrCard a="HR" b="SpO₂" r={stats.corr.hrSpo2} />
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Interpretation:</strong> Since the simulated data uses independent random distributions for each sensor, 
                correlations are expected to be near zero (negligible). In real clinical data, elevated temperature often correlates 
                with increased heart rate (positive) and decreased SpO₂ (negative) due to physiological stress responses.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Correlation indicates linear association only. It does not prove causality and can be unstable on small or noisy samples.
              </p>
            </>
          )}
        </Section>

        {/* ─── 7. Classification ─── */}
        <Section icon={<Wind />} title="7. Point-Level Classification Logic">
          <p className="text-sm text-muted-foreground mb-4">
            Each record is evaluated by deterministic rules in sequence. Rule order is important because higher-risk conditions must override lower-risk conditions.
          </p>
          <div className="space-y-3">
            <ClassCard
              status="INVALID"
              color="bg-status-invalid"
              rules={[
                "Temperature outside 30°C–45°C",
                "OR Heart Rate outside 30–220 bpm",
                "OR SpO₂ outside 70%–100%",
              ]}
              action="Invalid sensor reading. Please retake measurement"
            />
            <ClassCard
              status="CRITICAL"
              color="bg-status-critical"
              rules={["SpO₂ < 90%", "OR Temperature ≥ 39.5°C", "OR Heart Rate ≥ 140 bpm"]}
              action="Seek emergency care immediately"
            />
            <ClassCard
              status="ALERT"
              color="bg-status-alert"
              rules={["Temperature > 38.0°C", "OR SpO₂ < 94%"]}
              action="Visit the clinic immediately"
            />
            <ClassCard
              status="WARNING"
              color="bg-status-warning"
              rules={["Heart Rate > 100 bpm", "Applied only when CRITICAL and ALERT rules are false"]}
              action="Rest and monitor your condition"
            />
            <ClassCard
              status="OBSERVE"
              color="bg-status-observe"
              rules={[
                "Temperature between 37.3°C and 38.0°C",
                "OR Heart Rate between 95 and 100 bpm",
                "OR SpO₂ between 94% and 95%",
              ]}
              action="Recheck your vitals soon and continue observing"
            />
            <ClassCard
              status="SAFE"
              color="bg-status-safe"
              rules={["No CRITICAL/ALERT/WARNING/OBSERVE rule triggered"]}
              action="You are in good health"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
            Logical order implemented by the app is: check <span className="font-mono">INVALID</span> first, then <span className="font-mono">CRITICAL</span>, then <span className="font-mono">ALERT</span>, then <span className="font-mono">WARNING</span>, then <span className="font-mono">OBSERVE</span>, otherwise <span className="font-mono">SAFE</span>.
            This precedence prevents high-risk cases from being mislabeled as lower-severity categories.
          </p>
          {stats && (
            <div className="mt-4 flex gap-4 text-sm">
              <span className="text-status-invalid font-semibold">INVALID: {stats.invalid}</span>
              <span className="text-status-safe font-semibold">SAFE: {stats.safe}</span>
              <span className="text-status-observe font-semibold">OBSERVE: {stats.observe}</span>
              <span className="text-status-warning font-semibold">WARNING: {stats.warning}</span>
              <span className="text-status-alert font-semibold">ALERT: {stats.alert}</span>
              <span className="text-status-critical font-semibold">CRITICAL: {stats.critical}</span>
              <span className="text-muted-foreground">Total: {stats.total}</span>
            </div>
          )}
        </Section>

        {/* ─── 8. Data Summary ─── */}
        <Section icon={<Cpu />} title="8. Dataset Summary">
          <p className="text-sm text-muted-foreground mb-4">
            Snapshot of the dataset currently loaded in the dashboard for analysis and status monitoring.
          </p>
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatBox label="Total Records" value={stats.total.toLocaleString()} />
              <StatBox label="Sensors" value="3 (2 modules)" />
              <StatBox label="Sampling" value="Real-time" />
              <StatBox label="Classification" value="6 classes" />
            </div>
          )}
        </Section>

        {/* ─── 9. Acronym Glossary ─── */}
        <Section icon={<Cpu />} title="9. Acronym Glossary">
          <p className="text-sm text-muted-foreground mb-4">
            Quick reference for technical abbreviations used in this document.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-semibold text-foreground">Acronym</th>
                  <th className="py-2 pr-4 font-semibold text-foreground">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">I²C</td>
                  <td className="py-2 pr-4">Inter-Integrated Circuit communication bus</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">PPG</td>
                  <td className="py-2 pr-4">Photoplethysmography (optical blood volume waveform)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">IR</td>
                  <td className="py-2 pr-4">Infrared light channel</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">SpO₂</td>
                  <td className="py-2 pr-4">Peripheral capillary oxygen saturation</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">HR</td>
                  <td className="py-2 pr-4">Heart Rate</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">IBI</td>
                  <td className="py-2 pr-4">Inter-Beat Interval</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">LSB</td>
                  <td className="py-2 pr-4">Least Significant Bit</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono">AC / DC</td>
                  <td className="py-2 pr-4">Alternating (pulsatile) / Direct (baseline) signal components</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">ISO</td>
                  <td className="py-2 pr-4">International Organization for Standardization timestamp format</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Section>

        {/* ─── 10. Data Categorization and Classification ─── */}
        <Section icon={<Activity />} title="10. Data Categorization and Classification">
          <div className="space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.1 Group-Validated Expected Results</h3>
              <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
                <li>• Continuous ingestion of time-series records without missing mandatory fields.</li>
                <li>• Physiologically plausible ranges for temperature, heart rate, and SpO₂.</li>
                <li>• Deterministic and explainable class assignment (INVALID/SAFE/OBSERVE/WARNING/ALERT/CRITICAL) per record.</li>
                <li>• Real-time status consistency between stored label and threshold logic.</li>
                <li>• Clinically meaningful recommendation text linked to each assigned class.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.2 Classification Objective</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                The current objective is <span className="font-semibold text-foreground">risk stratification and anomaly flagging</span> at point level (each incoming reading).
                It is a rule-based clinical triage stage, not a long-horizon prediction model. In this deployment, three physiological channels are classified
                (temperature, heart rate, SpO₂), while the ESP32 and sensor modules provide the capture/transport pipeline.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.3 Time-Series to Label Mapping</h3>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                Continuous streams are categorized record-by-record using threshold precedence:
                <span className="font-mono"> INVALID (physiologically impossible values) → CRITICAL (SpO₂ &lt; 90 or temp ≥ 39.5 or HR ≥ 140) → ALERT (temp &gt; 38.0 or SpO₂ &lt; 94) → WARNING (HR &gt; 100) → OBSERVE (borderline ranges) → SAFE</span>.
              </p>
              {stats && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="py-2 pr-4 font-semibold text-foreground">Class</th>
                        <th className="py-2 pr-4 font-semibold text-foreground">Count</th>
                        <th className="py-2 pr-4 font-semibold text-foreground">Share</th>
                        <th className="py-2 pr-4 font-semibold text-foreground">Primary Trigger</th>
                      </tr>
                    </thead>
                    <tbody className="text-muted-foreground">
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4">INVALID</td>
                        <td className="py-2 pr-4">{stats.invalid}</td>
                        <td className="py-2 pr-4">{stats.classPct.invalid.toFixed(1)}%</td>
                        <td className="py-2 pr-4">Values outside valid physiological/device range</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4">CRITICAL</td>
                        <td className="py-2 pr-4">{stats.critical}</td>
                        <td className="py-2 pr-4">{stats.classPct.critical.toFixed(1)}%</td>
                        <td className="py-2 pr-4">SpO₂ &lt; 90 or Temp ≥ 39.5 or HR ≥ 140</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4">ALERT</td>
                        <td className="py-2 pr-4">{stats.alert}</td>
                        <td className="py-2 pr-4">{stats.classPct.alert.toFixed(1)}%</td>
                        <td className="py-2 pr-4">Temp &gt; 38.0 or SpO₂ &lt; 94 (not CRITICAL)</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4">WARNING</td>
                        <td className="py-2 pr-4">{stats.warning}</td>
                        <td className="py-2 pr-4">{stats.classPct.warning.toFixed(1)}%</td>
                        <td className="py-2 pr-4">HR &gt; 100 and not CRITICAL/ALERT</td>
                      </tr>
                      <tr className="border-b border-border/50">
                        <td className="py-2 pr-4">OBSERVE</td>
                        <td className="py-2 pr-4">{stats.observe}</td>
                        <td className="py-2 pr-4">{stats.classPct.observe.toFixed(1)}%</td>
                        <td className="py-2 pr-4">Borderline ranges and not higher-risk class</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">SAFE</td>
                        <td className="py-2 pr-4">{stats.safe}</td>
                        <td className="py-2 pr-4">{stats.classPct.safe.toFixed(1)}%</td>
                        <td className="py-2 pr-4">No threshold triggered</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.4 Correlation Logic Used During Class Transformation</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Classification itself remains threshold-based for interpretability. Correlation is applied as an analysis layer to verify whether multi-sensor behavior
                is coherent over time (for example, fever trends with elevated heart rate). Pearson coefficients quantify linear co-movement; they support quality review
                and future model design but do not override threshold labels in the current implementation.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.5 Mathematical Methods and Algorithms</h3>
              <ul className="text-xs text-muted-foreground space-y-1 leading-relaxed">
                <li>• Conversion equations map sensor-level digital outputs into °C, bpm, and SpO₂%.</li>
                <li>• Peak-interval method estimates heart rate from PPG waveform timing.</li>
                <li>• Ratio-of-ratios method estimates SpO₂ from red/IR AC-DC components.</li>
                <li>• Min-max scaling normalizes features for cross-signal comparability.</li>
                <li>• Pearson correlation measures linear association strength between sensors.</li>
                <li>• Deterministic rule engine performs final class assignment with explicit precedence.</li>
              </ul>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-foreground mb-2">10.6 Label Consistency Check (Stored vs Rule-Recomputed)</h3>
              <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                To verify data arrangement quality, each stored label is recomputed using the same threshold logic and compared for agreement.
              </p>
              {stats && (
                <>
                  <div className="grid sm:grid-cols-3 gap-3 mb-3">
                    <div className="bg-accent/30 rounded-xl p-3">
                      <p className="text-[10px] text-muted-foreground">Matched labels</p>
                      <p className="text-lg font-bold text-foreground">{stats.consistency.matched}</p>
                    </div>
                    <div className="bg-accent/30 rounded-xl p-3">
                      <p className="text-[10px] text-muted-foreground">Mismatched labels</p>
                      <p className="text-lg font-bold text-foreground">{stats.consistency.mismatched}</p>
                    </div>
                    <div className="bg-accent/30 rounded-xl p-3">
                      <p className="text-[10px] text-muted-foreground">Agreement rate</p>
                      <p className="text-lg font-bold text-foreground">
                        {((stats.consistency.matched / stats.total) * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="border-b border-border text-left">
                          <th className="py-2 pr-4 font-semibold text-foreground">Record</th>
                          <th className="py-2 pr-4 font-semibold text-foreground">Temp (°C)</th>
                          <th className="py-2 pr-4 font-semibold text-foreground">HR (bpm)</th>
                          <th className="py-2 pr-4 font-semibold text-foreground">SpO₂ (%)</th>
                          <th className="py-2 pr-4 font-semibold text-foreground">Stored</th>
                          <th className="py-2 pr-4 font-semibold text-foreground">Recomputed</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {stats.categorizedSample.map((row) => (
                          <tr key={row.id} className="border-b border-border/50">
                            <td className="py-2 pr-4 font-mono text-[10px]">{row.id.slice(0, 8)}</td>
                            <td className="py-2 pr-4">{row.temperature.toFixed(1)}</td>
                            <td className="py-2 pr-4">{row.heart_rate}</td>
                            <td className="py-2 pr-4">{row.spo2}</td>
                            <td className="py-2 pr-4">{row.stored}</td>
                            <td className={`py-2 pr-4 ${row.isConsistent ? "text-status-safe" : "text-status-alert"}`}>
                              {row.expected}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </Section>
      </main>

      <footer className="border-t border-border bg-card/50 mt-8 print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 text-center text-[11px] text-muted-foreground">
          © 2026 Contactless Sick-Bay — University of Rwanda · IoT Project
        </div>
      </footer>
    </div>
  );
}

/* ── Sub-components ── */

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card rounded-2xl border border-border shadow-card p-5 sm:p-6 animate-slide-up print:shadow-none print:break-inside-avoid print:bg-white">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-accent grid place-items-center text-accent-foreground">{icon}</div>
        <h2 className="font-display font-semibold text-foreground">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SensorCard({ name, id, type, protocol, desc }: { name: string; id: string; type: string; protocol: string; desc: string }) {
  return (
    <div className="bg-accent/30 rounded-xl p-4">
      <p className="font-semibold text-sm text-foreground">{name}</p>
      <p className="text-[10px] font-mono text-primary mt-0.5">{id}</p>
      <p className="text-xs text-muted-foreground mt-2">{type} · {protocol}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function FormulaCard({ sensor, formula, explanation, range }: { sensor: string; formula: string; explanation: string; range: string }) {
  return (
    <div className="bg-accent/30 rounded-xl p-4">
      <p className="font-semibold text-sm text-foreground mb-1">{sensor}</p>
      <p className="font-mono text-xs text-primary bg-background/60 rounded-lg px-3 py-2 mb-2">{formula}</p>
      <p className="text-xs text-muted-foreground leading-relaxed">{explanation}</p>
      <p className="text-[10px] text-muted-foreground mt-2">Range: {range}</p>
    </div>
  );
}

function CorrCard({ a, b, r }: { a: string; b: string; r: number }) {
  const label = corrLabel(r);
  return (
    <div className="bg-accent/30 rounded-xl p-4 text-center">
      <p className="text-xs text-muted-foreground">{a} ↔ {b}</p>
      <p className="text-xl font-bold text-foreground mt-1">{r.toFixed(3)}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label} {r >= 0 ? "positive" : "negative"}</p>
    </div>
  );
}

function ClassCard({ status, color, rules, action }: { status: string; color: string; rules: string[]; action: string }) {
  return (
    <div className="flex items-start gap-3 bg-accent/20 rounded-xl p-4">
      <div className={`w-3 h-3 rounded-full ${color} mt-0.5 shrink-0`} />
      <div>
        <p className="font-semibold text-sm text-foreground">{status}</p>
        <ul className="text-xs text-muted-foreground mt-1 space-y-0.5">
          {rules.map((r, i) => <li key={i}>• {r}</li>)}
        </ul>
        <p className="text-xs text-primary mt-1.5">→ {action}</p>
      </div>
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-accent/30 rounded-xl p-4 text-center">
      <p className="text-lg font-bold text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
