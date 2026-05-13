import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

/** Shape of `stats` from Documentation page useMemo (dataset-dependent blocks). */
export type DocumentationWordStats = {
  total: number;
  safe: number;
  invalid: number;
  observe: number;
  warning: number;
  alert: number;
  critical: number;
  classPct: {
    safe: number;
    invalid: number;
    observe: number;
    warning: number;
    alert: number;
    critical: number;
  };
  temp: { min: number; max: number; avg: number };
  hr: { min: number; max: number; avg: number };
  spo2: { min: number; max: number; avg: number };
  corr: { tempHr: number; tempSpo2: number; hrSpo2: number };
  consistency: { matched: number; mismatched: number };
  categorizedSample: {
    id: string;
    temperature: number;
    heart_rate: number;
    spo2: number;
    stored: string;
    expected: string;
    isConsistent: boolean;
  }[];
};

function p(text: string, opts?: { spacingBefore?: number }): Paragraph {
  return new Paragraph({
    spacing: { before: opts?.spacingBefore ?? 0, after: 160 },
    children: [new TextRun(text)],
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    text,
  });
}

function h2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    text,
  });
}

function tableFromMatrix(headers: string[], rows: string[][]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
        })
    ),
  });
  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: r.map((cell) => new TableCell({ children: [new Paragraph(cell)] })),
      })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...bodyRows],
  });
}

function corrLabel(r: number): string {
  const a = Math.abs(r);
  if (a > 0.7) return "Strong";
  if (a > 0.4) return "Moderate";
  if (a > 0.2) return "Weak";
  return "Negligible";
}

function buildChildren(stats: DocumentationWordStats | null): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      text: "Sensor Data Documentation & Analysis",
    }),
    p("University of Rwanda · IoT Project — Sick-Bay Kiosk", { spacingBefore: 0 }),
    p(
      "End-to-end technical documentation for how raw signals become clinical indicators: sensor capture, translation logic, formulas, calibration, normalization, correlation, and threshold-based status evaluation."
    ),
  ];

  out.push(h1("1. Sensor Identification & Hardware"));
  out.push(
    p(
      "Each sensor has a distinct physiological target and contributes one part of the final health assessment."
    )
  );
  out.push(
    tableFromMatrix(
      ["Sensor", "ID", "Type", "Protocol", "Description"],
      [
        [
          "MAX30205",
          "SENSOR-TEMP-01",
          "Temperature",
          "I2C (0x48)",
          "Human body temperature sensor, ±0.1°C accuracy",
        ],
        [
          "MAX30102 (IR)",
          "SENSOR-HR-01",
          "Heart Rate",
          "I2C (0x57)",
          "Infrared PPG channel for pulse detection",
        ],
        [
          "MAX30102 (Red)",
          "SENSOR-SPO2-01",
          "SpO2",
          "I2C (0x57)",
          "Red LED channel for blood oxygen estimation",
        ],
      ]
    )
  );
  out.push(
    p(
      "The MAX30205 measures skin-contact temperature digitally. The MAX30102 is an optical PPG sensor: IR is used for pulse timing (heart rate), while red/IR pair supports SpO2 estimation via relative light absorption."
    )
  );

  out.push(h1("2. Sensor Capture Format & Translation Flow"));
  out.push(
    p(
      "Stored record schema: { id, temperature, heart_rate, spo2, status, recommendation, created_at }. Types: temperature in °C (float), heart_rate in bpm (integer-like), spo2 in % (integer-like), created_at ISO timestamp."
    )
  );
  out.push(
    p(
      "Logical chain: Sensor sample → conditioning/filtering → feature extraction (peaks or AC/DC ratio) → unit conversion → threshold rules → status/recommendation."
    )
  );

  out.push(h1("3. Data Conversion Formulas"));
  out.push(
    p("MAX30205 — Temperature: T(°C) = Raw_16bit × 0.00390625. Each LSB is 1/256°C; improves repeatability across devices. Range: 35.0°C–42.0°C clinical.")
  );
  out.push(
    p(
      "MAX30102 — Heart Rate: HR(bpm) = 60 / avg(peak_intervals_sec). IR PPG peaks track beats; average IBI converts to bpm. Range: 40–200 bpm."
    )
  );
  out.push(
    p(
      "MAX30102 — SpO2: SpO2(%) = 110 - 25 × (R_red_AC/R_red_DC) / (R_ir_AC/R_ir_DC). Empirical approximation; calibrate vs reference oximeter. Range: 70%–100%."
    )
  );

  out.push(h1("4. Calibration Reference Values"));
  out.push(
    tableFromMatrix(
      ["Sensor", "Reference Instrument", "Reference Value", "Offset Applied"],
      [
        ["MAX30205", "Mercury thermometer (±0.1°C)", "36.5°C", "+0.2°C correction"],
        ["MAX30102 (HR)", "Clinical pulse oximeter (HR mode)", "72 bpm at rest", "±2 bpm tolerance"],
        ["MAX30102 (SpO2)", "Clinical pulse oximeter", "98% at rest", "±1% tolerance"],
      ]
    )
  );

  out.push(h1("5. Data Normalization (Min-Max Scaling)"));
  out.push(p("X_norm = (X - X_min) / (X_max - X_min). Dashboard decisions use native units; normalization supports analytics and model preprocessing."));
  if (stats) {
    out.push(
      tableFromMatrix(
        ["Parameter", "Min", "Max", "Mean"],
        [
          ["Temperature (°C)", stats.temp.min.toFixed(1), stats.temp.max.toFixed(1), stats.temp.avg.toFixed(2)],
          ["Heart Rate (bpm)", String(stats.hr.min), String(stats.hr.max), stats.hr.avg.toFixed(1)],
          ["SpO2 (%)", String(stats.spo2.min), String(stats.spo2.max), stats.spo2.avg.toFixed(1)],
        ]
      )
    );
  } else {
    out.push(p("No vitals loaded: normalization summary table omitted. Load data on the dashboard and export again."));
  }

  out.push(h1("6. Sensor Data Correlation (Pearson)"));
  if (stats) {
    out.push(p(`Computed from ${stats.total} records.`));
    out.push(
      tableFromMatrix(
        ["Pair", "r", "Strength"],
        [
          ["Temp ↔ HR", stats.corr.tempHr.toFixed(3), `${corrLabel(stats.corr.tempHr)} ${stats.corr.tempHr >= 0 ? "positive" : "negative"}`],
          ["Temp ↔ SpO2", stats.corr.tempSpo2.toFixed(3), `${corrLabel(stats.corr.tempSpo2)} ${stats.corr.tempSpo2 >= 0 ? "positive" : "negative"}`],
          ["HR ↔ SpO2", stats.corr.hrSpo2.toFixed(3), `${corrLabel(stats.corr.hrSpo2)} ${stats.corr.hrSpo2 >= 0 ? "positive" : "negative"}`],
        ]
      )
    );
    out.push(
      p(
        "Independent random per-sensor data yields correlations near zero. Real clinical data often shows fever with higher HR and lower SpO2. Correlation is linear association only, not causality."
      )
    );
  } else {
    out.push(p("No vitals loaded: correlation table omitted."));
  }

  out.push(h1("7. Point-Level Classification Logic"));
  out.push(
    p(
      "Order: INVALID → CRITICAL → ALERT → WARNING → OBSERVE → SAFE. INVALID: temp outside 30–45°C, HR outside 30–220, or SpO2 outside 70–100%. CRITICAL: SpO2 < 90% OR temp ≥ 39.5°C OR HR ≥ 140. ALERT: temp > 38.0°C OR SpO2 < 94%. WARNING: HR > 100 when not CRITICAL/ALERT. OBSERVE: borderline ranges. SAFE: otherwise."
    )
  );
  if (stats) {
    out.push(
      p(
        `Counts — INVALID: ${stats.invalid}, SAFE: ${stats.safe}, OBSERVE: ${stats.observe}, WARNING: ${stats.warning}, ALERT: ${stats.alert}, CRITICAL: ${stats.critical}, Total: ${stats.total}`
      )
    );
  }

  out.push(h1("8. Dataset Summary"));
  if (stats) {
    out.push(
      tableFromMatrix(
        ["Metric", "Value"],
        [
          ["Total Records", stats.total.toLocaleString()],
          ["Sensors", "3 (2 modules)"],
          ["Sampling", "Real-time"],
          ["Classification", "6 classes"],
        ]
      )
    );
  } else {
    out.push(p("No vitals loaded."));
  }

  out.push(h1("9. Acronym Glossary"));
  out.push(
    tableFromMatrix(
      ["Acronym", "Meaning"],
      [
        ["I2C", "Inter-Integrated Circuit bus"],
        ["PPG", "Photoplethysmography"],
        ["IR", "Infrared channel"],
        ["SpO2", "Peripheral capillary oxygen saturation"],
        ["HR", "Heart rate"],
        ["IBI", "Inter-beat interval"],
        ["LSB", "Least significant bit"],
        ["AC / DC", "Pulsatile / baseline signal components"],
        ["ISO", "International Organization for Standardization timestamp"],
      ]
    )
  );

  out.push(h1("10. Data Categorization and Classification"));
  out.push(h2("10.1 Group-validated expectations"));
  out.push(
    p(
      "Continuous ingestion; plausible ranges; deterministic INVALID/SAFE/OBSERVE/WARNING/ALERT/CRITICAL; realtime consistency with threshold logic; recommendation text per class."
    )
  );
  out.push(h2("10.2 Objective"));
  out.push(
    p(
      "Risk stratification and anomaly flagging per reading (rule-based triage), not long-horizon prediction. ESP32 + modules provide capture/transport."
    )
  );
  out.push(h2("10.3 Time-series to label mapping"));
  if (stats) {
    out.push(
      tableFromMatrix(
        ["Class", "Count", "Share", "Primary trigger"],
        [
          ["INVALID", String(stats.invalid), `${stats.classPct.invalid.toFixed(1)}%`, "Out of valid range"],
          ["CRITICAL", String(stats.critical), `${stats.classPct.critical.toFixed(1)}%`, "SpO2 < 90 or temp ≥ 39.5 or HR ≥ 140"],
          ["ALERT", String(stats.alert), `${stats.classPct.alert.toFixed(1)}%`, "Temp > 38.0 or SpO2 < 94 (not CRITICAL)"],
          ["WARNING", String(stats.warning), `${stats.classPct.warning.toFixed(1)}%`, "HR > 100, not CRITICAL/ALERT"],
          ["OBSERVE", String(stats.observe), `${stats.classPct.observe.toFixed(1)}%`, "Borderline, not higher risk"],
          ["SAFE", String(stats.safe), `${stats.classPct.safe.toFixed(1)}%`, "No threshold triggered"],
        ]
      )
    );
  } else {
    out.push(p("Class distribution table omitted (no data)."));
  }
  out.push(h2("10.4 Correlation vs classification"));
  out.push(
    p(
      "Classification stays threshold-based. Correlation supports QA and future models; it does not override labels in this deployment."
    )
  );
  out.push(h2("10.5 Methods summary"));
  out.push(
    p(
      "Conversion equations; peak-interval HR; ratio-of-ratios SpO2; min-max scaling; Pearson correlation; deterministic rule engine with precedence."
    )
  );
  out.push(h2("10.6 Label consistency (stored vs recomputed)"));
  if (stats) {
    const agree = ((stats.consistency.matched / stats.total) * 100).toFixed(1);
    out.push(
      p(`Matched: ${stats.consistency.matched}, Mismatched: ${stats.consistency.mismatched}, Agreement: ${agree}%`)
    );
    out.push(
      tableFromMatrix(
        ["Record (prefix)", "Temp", "HR", "SpO2", "Stored", "Recomputed"],
        stats.categorizedSample.map((row) => [
          row.id.slice(0, 8),
          row.temperature.toFixed(1),
          String(row.heart_rate),
          String(row.spo2),
          row.stored,
          row.expected,
        ])
      )
    );
  } else {
    out.push(p("Consistency sample omitted (no data)."));
  }

  out.push(
    new Paragraph({
      spacing: { before: 400, after: 120 },
      children: [
        new TextRun({
          text: `Generated ${new Date().toLocaleString()} — Contactless Sick-Bay, University of Rwanda`,
          italics: true,
        }),
      ],
    })
  );

  return out;
}

export async function downloadSensorDocumentationWord(stats: DocumentationWordStats | null): Promise<void> {
  const doc = new Document({
    title: "Sensor Data Documentation",
    creator: "Sick-Bay Kiosk",
    description: "Sensor and classification documentation export",
    sections: [
      {
        properties: {},
        children: buildChildren(stats),
      },
    ],
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sick-bay-sensor-documentation-${new Date().toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
