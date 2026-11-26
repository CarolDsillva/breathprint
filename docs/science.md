# The model behind Breathprint

## Inhaled dose

For each person and each slice of the day:

```
dose (µg) = C_outdoor (µg/m³) × ratio(place) + C_source   ← concentration where they are
            × ventilation(age, effort) (m³/h)              ← how much air they breathe
            × time (h)
```

Time not covered by an activity is spent at home, asleep during sleeping hours, otherwise resting.

**Ventilation rates (m³/h)**, US EPA Exposure Factors Handbook 2011, Table 6-2 (means, rounded):

| | sleep | rest | light | moderate | vigorous |
|---|---|---|---|---|---|
| Child 5–11 | 0.27 | 0.29 | 0.66 | 1.32 | 2.5 |
| Teen 12–17 | 0.29 | 0.30 | 0.74 | 1.6 | 2.9 |
| Adult | 0.30 | 0.31 | 0.72 | 1.6 | 3.0 |
| Senior 65+ | 0.30 | 0.29 | 0.72 | 1.5 | 2.8 |

**Cigarette equivalents** = Σ(concentration × hours) ÷ (22 × 24), after Berkeley Earth.
**WHO multiple** = dose ÷ (15 µg/m³ × volume breathed).

## Clean-room model

Single well-mixed room:

```
dC/dt = P·a·C_out − (a + k + CADR/V)·C
C_ss  = P·a·C_out / (a + k + CADR/V)
t     = −ln((target − C_ss) / (C_0 − C_ss)) / (a + k + CADR/V)
```

P = 0.8 penetration, k = 0.2 /h deposition, a = 0.7 /h (closed) or 4 /h (window open).
A DIY box fan with four MERV-13 filters is taken as ~600 m³/h CADR.
The recommended CADR is 5 clean-air changes per hour × room volume.

## Ranking choices

Weighted family dose = Σ dose × (age weight + 0.5 if sensitive), with age weights child 1.5, teen 1.2, adult 1.0, senior 1.3.
Score = −Δweighted% + 0.25 × CO₂ saved %. A change must score at least 0.5 to be suggested.
