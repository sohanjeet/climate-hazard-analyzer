"""Synthetic (not real) temperature data with a known number of heatwaves per year, for trend tests."""
from datetime import date, timedelta

# Heatwave lengths (days) injected per year. Frequency 0,1,2,3,4 and mean duration 3, 3.5, 4, 4.5.
SPELLS = {
    2020: [],
    2021: [3],
    2022: [3, 4],
    2023: [3, 4, 5],
    2024: [3, 4, 5, 6],
}
HOT_C = 45.0
COOL_C = 15.0


def span(start, end):
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


def spell_days(spells=SPELLS):
    days = set()
    for year, lengths in spells.items():
        for i, length in enumerate(lengths):
            first = date(year, 1, 1) + timedelta(days=20 + 20 * i)
            days.update(first + timedelta(days=k) for k in range(length))
    return days


def temperature(day, hot_days, first_analysis_year=2020):
    """Baseline years: 20.0-29.9 C pseudo-cycle (95th percentile near 29.5). Later years: cool, plus hot spells."""
    if day.year < first_analysis_year:
        return 20.0 + ((day.toordinal() * 37) % 100) / 10
    return HOT_C if day in hot_days else COOL_C


def series(start, end, spells=SPELLS):
    hot = spell_days(spells)
    return {d: temperature(d, hot) for d in span(start, end)}
