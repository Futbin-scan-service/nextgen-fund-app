import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt
import yfinance as yf
import numpy as np

st.set_page_config(
    page_title="NextGen Robotics AI & Tech Fund",
    page_icon="📈",
    layout="centered"
)

st.markdown("""
<style>
header {visibility: hidden;}
footer {visibility: hidden;}

.block-container {
    padding-top: 0.8rem;
    padding-bottom: 2rem;
    max-width: 760px;
}

.stApp {
    background: #0b1020;
    color: #f8fafc;
}

h1, h2, h3, p, label, span {
    color: #f8fafc;
}

.subtitle {
    color: #94a3b8;
    font-size: 14px;
    margin-top: -6px;
}

.divider {
    height: 1px;
    background: #334155;
    margin: 16px 0 20px 0;
}

.metric-card, .factsheet-card {
    background: #111827;
    padding: 17px;
    border-radius: 16px;
    border: 1px solid #334155;
    margin-bottom: 12px;
}

.metric-label {
    font-size: 14px;
    color: #94a3b8;
}

.metric-value {
    font-size: 26px;
    color: #38bdf8;
    font-weight: 800;
}

.section-title {
    margin-top: 22px;
    margin-bottom: 10px;
    font-size: 22px;
    font-weight: 800;
}

.badge {
    display: inline-block;
    background: #f59e0b;
    color: #111827;
    padding: 6px 10px;
    border-radius: 8px;
    font-weight: 800;
    font-size: 12px;
    margin-bottom: 10px;
}

.risk-scale {
    display: flex;
    width: 100%;
    overflow: hidden;
    border-radius: 10px;
    margin: 12px 0;
    border: 1px solid #334155;
}

.risk-box {
    flex: 1;
    text-align: center;
    padding: 10px 0;
    font-weight: 800;
    color: #111827;
}

.risk-active {
    outline: 3px solid #ffffff;
    outline-offset: -3px;
}

.text-card {
    background: #111827;
    padding: 16px;
    border-radius: 14px;
    border: 1px solid #334155;
    margin-bottom: 12px;
    color: #e5e7eb;
    line-height: 1.45;
}

.good {
    border-left: 5px solid #22c55e;
}

.bad {
    border-left: 5px solid #ef4444;
}

.stTabs [data-baseweb="tab"] {
    background: #111827;
    border-radius: 12px;
    padding: 9px 10px;
    border: 1px solid #334155;
    font-size: 13px;
}

.stTabs [aria-selected="true"] {
    background: #1e293b;
    border: 1px solid #38bdf8;
}

.stSlider {
    background: #111827;
    padding: 16px;
    border-radius: 16px;
    border: 1px solid #334155;
    margin-bottom: 14px;
}

.stButton > button {
    width: 100%;
    background: #0ea5e9;
    color: white;
    border: none;
    border-radius: 14px;
    padding: 14px;
    font-size: 18px;
    font-weight: 700;
}
</style>
""", unsafe_allow_html=True)


DEFAULT_PORTFOLIO = {
    "NVDA": 9.11,
    "MSFT": 8.34,
    "AMZN": 6.31,
    "GOOGL": 6.26,
    "ASML": 5.12,
    "PLTR": 4.71,
    "AMD": 4.68,
    "META": 4.67,
    "TSM": 4.63,
    "TSLA": 4.36,
    "AVGO": 4.29,
    "NOW": 4.10,
    "CRWD": 3.12,
    "ISRG": 3.06,
    "CASH": 3.00,
    "BOND": 7.60,
    "SNOW": 2.55,
    "SYM": 2.53,
    "TER": 2.51,
    "QCOM": 2.21,
    "6954.T": 2.14,
    "PATH": 1.65,
    "KGX.DE": 1.53,
    "INTC": 1.52
}

ANTEILSPREIS_START = 49.75
AUSGABEAUFSCHLAG = 0.045
LAUFENDE_KOSTEN = 0.0196


def euro(value):
    return f"{value:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


@st.cache_data
def load_portfolio():
    try:
        df = pd.read_csv("fonds.csv")
        return dict(zip(df["Symbol"], df["Allocation"]))
    except Exception:
        return DEFAULT_PORTFOLIO


PORTFOLIO = load_portfolio()


@st.cache_data(ttl=3600)
def load_backtest():
    stock_portfolio = {
        k: v for k, v in PORTFOLIO.items()
        if k not in ["CASH", "BOND"]
    }

    try:
        tickers = list(stock_portfolio.keys())
        data = yf.download(tickers, period="5y", auto_adjust=True, progress=False)

        prices = data["Close"].dropna(axis=1, how="all")
        returns = prices.pct_change().dropna()
        available = list(returns.columns)

        weights = pd.Series({ticker: stock_portfolio[ticker] for ticker in available})

        cash_weight = PORTFOLIO.get("CASH", 0)
        bond_weight = PORTFOLIO.get("BOND", 0)
        equity_weight_total = weights.sum()

        weights = weights / weights.sum() * (equity_weight_total / 100)

        stock_returns = returns[available].dot(weights)

        cash_returns = pd.Series(0, index=stock_returns.index)
        bond_returns = pd.Series(0.025 / 252, index=stock_returns.index)

        portfolio_returns = (
            stock_returns
            + cash_returns * (cash_weight / 100)
            + bond_returns * (bond_weight / 100)
        )

        portfolio_returns_net = portfolio_returns - (LAUFENDE_KOSTEN / 252)

        portfolio_index = (1 + portfolio_returns_net).cumprod() * 100
        portfolio_index.iloc[0] = 100

        benchmark_data = yf.download("^NDX", period="5y", auto_adjust=True, progress=False)
        benchmark_prices = benchmark_data["Close"].dropna()
        benchmark_index = benchmark_prices / benchmark_prices.iloc[0] * 100

        combined = pd.concat([portfolio_index, benchmark_index], axis=1, join="inner")
        combined.columns = ["NextGen Portfolio", "NASDAQ-100"]

        days = (portfolio_index.index[-1] - portfolio_index.index[0]).days
        cagr = (portfolio_index.iloc[-1] / portfolio_index.iloc[0]) ** (365 / days) - 1
        current_share_price = ANTEILSPREIS_START * (portfolio_index.iloc[-1] / 100)

        return portfolio_index, combined, cagr, current_share_price

    except Exception:
        dates = pd.date_range(end=pd.Timestamp.today(), periods=60, freq="ME")
        portfolio_index = pd.Series(np.linspace(100, 165, len(dates)), index=dates)
        benchmark_index = pd.Series(np.linspace(100, 145, len(dates)), index=dates)
        combined = pd.concat([portfolio_index, benchmark_index], axis=1)
        combined.columns = ["NextGen Portfolio", "NASDAQ-100"]
        return portfolio_index, combined, 0.105, 82.09


portfolio_index, comparison_index, cagr, current_share_price = load_backtest()

df_portfolio = pd.DataFrame({
    "Ticker": list(PORTFOLIO.keys()),
    "Gewichtung": list(PORTFOLIO.values())
}).sort_values("Gewichtung", ascending=False)

if "investiert" not in st.session_state:
    st.session_state.investiert = 0.0

if "anteile" not in st.session_state:
    st.session_state.anteile = 0.0


col1, col2 = st.columns([1, 3])

with col1:
    st.image("logo.png", width=90)

with col2:
    st.markdown("""
    <h1 style="font-size:26px; margin-bottom:4px;">
        R0b0tics NextGen Technology Fonds
    </h1>
    <p class="subtitle">
        Digitale Fondsplattform · historischer Backtest des Musterportfolios
    </p>
    """, unsafe_allow_html=True)

st.markdown('<div class="divider"></div>', unsafe_allow_html=True)

tab1, tab2, tab3, tab4, tab5, tab6 = st.tabs([
    "Übersicht",
    "Sparplan",
    "Investieren",
    "Depot",
    "Portfolio",
    "Factsheet"
])


with tab1:
    st.markdown("## Historische Simulation")

    c1, c2 = st.columns(2)

    with c1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Historische Rendite p.a.</div>
            <div class="metric-value">{cagr * 100:.2f} %</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Wert eines Fondsanteils heute</div>
            <div class="metric-value">{euro(current_share_price)}</div>
        </div>
        """, unsafe_allow_html=True)

    fig, ax = plt.subplots(figsize=(7, 4))
    fig.patch.set_facecolor("#111827")
    ax.set_facecolor("#111827")
    ax.plot(portfolio_index.index, portfolio_index.values, color="#38bdf8", linewidth=2.5)
    ax.fill_between(portfolio_index.index, portfolio_index.values, 100, color="#38bdf8", alpha=0.18)
    ax.set_title("Backtest des Musterportfolios", color="white")
    ax.set_ylabel("Indexiert auf 100", color="white")
    ax.tick_params(colors="white", labelsize=8)
    ax.grid(alpha=0.18)
    st.pyplot(fig)

    st.caption(
        "Backtest mit heutigen Gewichtungen des Musterportfolios, abzüglich laufender Kosten von 1,96 % p.a. "
        "Vergangene Wertentwicklung ist keine Garantie für zukünftige Ergebnisse."
    )


with tab2:
    st.markdown("## Sparplan-Rechner")

    monatlicher_betrag = st.slider("Monatliche Sparrate (€)", 10, 1000, 50, 10)
    jahre = st.slider("Anlagezeitraum (Jahre)", 1, 40, 20, 1)

    r_annual = cagr
    months = jahre * 12
    r_monthly = r_annual / 12

    total_invested = monatlicher_betrag * months
    total_value = 0
    values_history = [0]
    invested_history = [0]

    for m in range(1, months + 1):
        total_value = (total_value + monatlicher_betrag) * (1 + r_monthly)
        if m % 12 == 0:
            values_history.append(total_value)
            invested_history.append(monatlicher_betrag * m)

    profit = total_value - total_invested
    years_axis = list(range(len(values_history)))

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Berechnungsbasis</div>
        <div class="metric-value" style="font-size:22px;">{cagr * 100:.2f} % p.a.</div>
    </div>
    """, unsafe_allow_html=True)

    c1, c2 = st.columns(2)

    with c1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Endwert</div>
            <div class="metric-value">{euro(total_value)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Einzahlungen</div>
            <div class="metric-value">{euro(total_invested)}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Wertzuwachs</div>
        <div class="metric-value">{euro(profit)}</div>
    </div>
    """, unsafe_allow_html=True)

    fig_sp, ax_sp = plt.subplots(figsize=(7, 4))
    fig_sp.patch.set_facecolor("#111827")
    ax_sp.set_facecolor("#111827")
    ax_sp.fill_between(years_axis, invested_history, color="#64748b", alpha=0.85, label="Einzahlungen")
    ax_sp.fill_between(years_axis, invested_history, values_history, color="#38bdf8", alpha=0.75, label="Wertzuwachs")
    ax_sp.set_title("Sparplan-Projektion", color="white")
    ax_sp.set_xlabel("Jahre", color="white")
    ax_sp.set_ylabel("Betrag (€)", color="white")
    ax_sp.tick_params(colors="white", labelsize=8)
    ax_sp.grid(alpha=0.18)
    ax_sp.legend(loc="upper left")
    ax_sp.get_yaxis().set_major_formatter(
        plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
    )
    st.pyplot(fig_sp)

    st.caption(
        "Der Sparplan nutzt die historische Durchschnittsrendite des Musterportfolios aus dem Backtest. "
        "Dies ist keine Prognose und keine Garantie."
    )


with tab3:
    st.markdown("## Fondsanteile kaufen")

    betrag = st.slider("Investitionsbetrag (€)", 100, 10000, 500, 100)

    ausgabeaufschlag = betrag * AUSGABEAUFSCHLAG
    nettobetrag = betrag - ausgabeaufschlag
    anteile = nettobetrag / current_share_price

    cards = [
        ("Investitionsbetrag", euro(betrag)),
        ("Ausgabeaufschlag 4,50 %", euro(ausgabeaufschlag)),
        ("Investierter Nettobetrag", euro(nettobetrag)),
        ("Fondsanteile", f"{anteile:.2f}")
    ]

    for label, value in cards:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">{label}</div>
            <div class="metric-value">{value}</div>
        </div>
        """, unsafe_allow_html=True)

    if st.button("Jetzt investieren"):
        st.session_state.investiert += nettobetrag
        st.session_state.anteile += anteile
        st.success(f"Order erfasst: {euro(nettobetrag)} wurden in {anteile:.2f} Fondsanteile investiert.")

    st.caption("Demo-Modus: Es findet keine echte Orderausführung statt.")


with tab4:
    st.markdown("## Mein Depot")

    depotwert = st.session_state.anteile * current_share_price
    gewinn = depotwert - st.session_state.investiert
    performance = gewinn / st.session_state.investiert * 100 if st.session_state.investiert > 0 else 0

    c1, c2 = st.columns(2)

    for col, label, value in [
        (c1, "Depotwert", euro(depotwert)),
        (c2, "Performance", f"{performance:+.2f} %")
    ]:
        with col:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">{label}</div>
                <div class="metric-value">{value}</div>
            </div>
            """, unsafe_allow_html=True)

    c3, c4 = st.columns(2)

    for col, label, value in [
        (c3, "Investiert", euro(st.session_state.investiert)),
        (c4, "Fondsanteile", f"{st.session_state.anteile:.2f}")
    ]:
        with col:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">{label}</div>
                <div class="metric-value">{value}</div>
            </div>
            """, unsafe_allow_html=True)

    st.markdown("## Vergleich mit NASDAQ-100")

    startbetrag = st.session_state.investiert if st.session_state.investiert > 0 else 100
    scaled_nextgen = comparison_index["NextGen Portfolio"] / 100 * startbetrag
    scaled_nasdaq = comparison_index["NASDAQ-100"] / 100 * startbetrag

    fig2, ax2 = plt.subplots(figsize=(7, 4))
    fig2.patch.set_facecolor("#111827")
    ax2.set_facecolor("#111827")
    ax2.plot(scaled_nextgen.index, scaled_nextgen.values, color="#38bdf8", linewidth=2.5, label="NextGen Portfolio")
    ax2.plot(scaled_nasdaq.index, scaled_nasdaq.values, color="#94a3b8", linewidth=2.2, label="NASDAQ-100")
    ax2.set_title("Depotentwicklung im Vergleich", color="white")
    ax2.set_ylabel("Depotwert (€)", color="white")
    ax2.tick_params(colors="white", labelsize=8)
    ax2.grid(alpha=0.18)
    ax2.legend(loc="upper left")
    ax2.get_yaxis().set_major_formatter(
        plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
    )
    st.pyplot(fig2)

    if st.button("Depot zurücksetzen"):
        st.session_state.investiert = 0.0
        st.session_state.anteile = 0.0
        st.rerun()


with tab5:
    st.markdown("## Portfolio")

    fig3, ax3 = plt.subplots(figsize=(7, 5.5))
    fig3.patch.set_facecolor("#111827")
    ax3.set_facecolor("#111827")

    top = df_portfolio.head(15).sort_values("Gewichtung")
    ax3.barh(top["Ticker"], top["Gewichtung"], color="#38bdf8")
    ax3.set_xlabel("Gewichtung (%)", color="white")
    ax3.set_title("Top 15 Positionen", color="white")
    ax3.tick_params(colors="white", labelsize=8)
    ax3.grid(axis="x", alpha=0.18)

    for i, value in enumerate(top["Gewichtung"]):
        ax3.text(value + 0.1, i, f"{value:.2f}%", color="white", va="center", fontsize=8)

    st.pyplot(fig3)

    st.markdown("## Größte Positionen")

    for _, row in df_portfolio.head(10).iterrows():
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">{row["Ticker"]}</div>
            <div class="metric-value" style="font-size:23px;">{row["Gewichtung"]:.2f} %</div>
        </div>
        """, unsafe_allow_html=True)


with tab6:
    st.markdown('<span class="badge">⚠ MARKETING-ANZEIGE</span>', unsafe_allow_html=True)
    st.markdown("## Digitales Factsheet")

    st.markdown("### R0b0tics NextGen Technology Fonds")
    st.caption("Anteilklasse R — Marketing-Factsheet | Stand: Juni 2026")
    st.caption("ISIN: LU3956745017 | WKN: A314TE")

    st.markdown('<div class="section-title">1. Stammdaten & Struktur</div>', unsafe_allow_html=True)

    stammdaten = [
        ("Fondsname", "R0b0tics NextGen Technology Fonds"),
        ("ISIN / WKN", "LU3956745017 / A314TE"),
        ("Rechtsform", "SICAV (Teil I gemäß Gesetz vom 17.12.2010)"),
        ("Kategorie / Währung", "Aktienfonds / Euro (EUR)"),
        ("Verwaltungsgesellschaft", "IPConcept (Luxemburg) S.A."),
        ("Verwahrstelle", "DZ PRIVATBANK AG, Niederlassung Luxemburg"),
        ("Fondsmanager", "Robotics NextGen GmbH"),
        ("Ertragsverwendung", "Thesaurierend (reinvestierend)"),
        ("Erstöffnung", "01.07.2026"),
        ("Verwaltungsstil", "Aktiv verwaltet"),
        ("Benchmark", "NASDAQ-100")
    ]

    for label, value in stammdaten:
        st.markdown(f"""
        <div class="factsheet-card">
            <div class="metric-label">{label}</div>
            <div class="metric-value" style="font-size:20px;">{value}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown('<div class="section-title">2. Marktdaten & Kennzahlen</div>', unsafe_allow_html=True)

    kennzahlen = [
        ("Fondsvermögen (NAV)", "20.000.000,00 EUR"),
        ("Rücknahmepreis", "49,75 EUR"),
        ("Umlaufende Anteile", "400.000 Stück"),
        ("Laufende Kosten (OGC)", "1,96 % p.a."),
        ("Zeichnungsgebühr (AA)", "4,50 %"),
        ("Verwaltungsgebühr", "1,55 % p.a."),
        ("Rückzahlungsgebühr", "0,00 %"),
        ("Erfolgsgebühr", "0,00 %")
    ]

    for label, value in kennzahlen:
        st.markdown(f"""
        <div class="factsheet-card">
            <div class="metric-label">{label}</div>
            <div class="metric-value" style="font-size:20px;">{value}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown('<div class="section-title">3. Asset-Allokation</div>', unsafe_allow_html=True)

    asset_labels = ["Aktien", "Anleihen", "Liquidität"]
    asset_values = [89.40, 7.60, 3.00]

    fig_asset, ax_asset = plt.subplots(figsize=(7, 3))
    fig_asset.patch.set_facecolor("#111827")
    ax_asset.set_facecolor("#111827")
    ax_asset.barh(asset_labels, asset_values, color="#38bdf8")
    ax_asset.set_xlim(0, 100)
    ax_asset.tick_params(colors="white")
    ax_asset.set_xlabel("Anteil (%)", color="white")
    ax_asset.grid(axis="x", alpha=0.18)
    for i, v in enumerate(asset_values):
        ax_asset.text(v + 1, i, f"{v:.2f} %", color="white", va="center")
    st.pyplot(fig_asset)

    st.markdown('<div class="section-title">4. Währungsallokation</div>', unsafe_allow_html=True)

    currency_labels = ["USD", "EUR"]
    currency_values = [87.09, 12.91]

    fig_curr, ax_curr = plt.subplots(figsize=(7, 2.5))
    fig_curr.patch.set_facecolor("#111827")
    ax_curr.set_facecolor("#111827")
    ax_curr.barh(currency_labels, currency_values, color="#38bdf8")
    ax_curr.set_xlim(0, 100)
    ax_curr.tick_params(colors="white")
    ax_curr.set_xlabel("Anteil (%)", color="white")
    ax_curr.grid(axis="x", alpha=0.18)
    for i, v in enumerate(currency_values):
        ax_curr.text(v + 1, i, f"{v:.2f} %", color="white", va="center")
    st.pyplot(fig_curr)

    st.markdown('<div class="section-title">5. Top-Einzelpositionen</div>', unsafe_allow_html=True)

    top_positions = [
        ("NVIDIA Corporation", "US67066G1040", "9,11 %"),
        ("Microsoft Corporation", "US5949181045", "8,34 %"),
        ("Amazon.com, Inc.", "US0231351067", "6,31 %"),
        ("Alphabet Inc.", "US02079K3053", "6,26 %"),
        ("ASML Holding NV", "NL0010273215", "5,12 %"),
        ("Palantir Technologies Inc.", "US69608A1088", "4,71 %"),
        ("Advanced Micro Devices Inc.", "US0079031078", "4,68 %"),
        ("Meta Platforms, Inc.", "US30303M1027", "4,67 %")
    ]

    for name, isin, weight in top_positions:
        st.markdown(f"""
        <div class="factsheet-card">
            <div class="metric-label">{isin}</div>
            <div class="metric-value" style="font-size:20px;">{name}</div>
            <div style="color:#38bdf8; font-weight:800;">{weight}</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown('<div class="section-title">6. Risikoprofil & Liquiditätssicherung</div>', unsafe_allow_html=True)

    st.markdown("""
    <div class="text-card">
        Gesamtrisikoindikator: <b>Risikoklasse 5 von 7</b>
    </div>
    """, unsafe_allow_html=True)

    colors = ["#22c55e", "#84cc16", "#d9e021", "#facc15", "#fb923c", "#ef4444", "#991b1b"]
    risk_html = '<div class="risk-scale">'
    for i, color in enumerate(colors, start=1):
        active = "risk-active" if i == 5 else ""
        risk_html += f'<div class="risk-box {active}" style="background:{color};">{i}</div>'
    risk_html += '</div>'
    st.markdown(risk_html, unsafe_allow_html=True)

    st.markdown("""
    <div class="text-card">
        Mit der Einstufung in Risikoklasse 5 weist die SICAV ein mittelhohes systemisches Risiko auf.
        Das Marktrisikoframework basiert auf einem relativen Value at Risk von maximal 175 %
        bezogen auf das Referenzportfolio NASDAQ-100.
        <br><br>
        Zur Liquiditätssicherung gelten: Liquiditätssockel ≥ 1,00 %, Liquiditätspuffer ≥ 50,00 %
        sowie Liquiditätsreserve ≥ 90,00 % des Gesamtvolumens.
    </div>
    """, unsafe_allow_html=True)

    st.markdown('<div class="section-title">7. Chancen und Risiken</div>', unsafe_allow_html=True)

    chances = [
        "Wachstumspotenzial Robotik & KI",
        "Aktives Management relativ zum NASDAQ-100",
        "Globale Diversifikation über führende Technologieunternehmen",
        "Thesaurierung ermöglicht langfristigen Zinseszinseffekt"
    ]

    risks = [
        "Markt- und Volatilitätsrisiko bei Technologiewerten",
        "Währungsrisiko durch hohen USD-Anteil",
        "Konzentrationsrisiko durch große Top-Positionen",
        "Regulatorisches Risiko bei Technologieunternehmen"
    ]

    st.markdown("### ▲ Chancen")
    for item in chances:
        st.markdown(f'<div class="text-card good">{item}</div>', unsafe_allow_html=True)

    st.markdown("### ▼ Risiken")
    for item in risks:
        st.markdown(f'<div class="text-card bad">{item}</div>', unsafe_allow_html=True)

    st.markdown('<div class="section-title">Digital Investor Hub</div>', unsafe_allow_html=True)

    st.markdown("""
    <div class="text-card">
        Ausführliche Berichte, tägliche NAV-Preisanpassungen sowie weiterführende Informationen
        finden Sie auf unserer digitalen Fondsplattform.
    </div>
    """, unsafe_allow_html=True)

    st.markdown('<div class="section-title">Wichtiger rechtlicher Hinweis</div>', unsafe_allow_html=True)

    st.markdown("""
    <div class="text-card">
        Dieses digitale Factsheet dient ausschließlich Werbe- und Seminarzwecken im Rahmen einer Hochschulübung
        und stellt keine reale Anlageberatung oder ein verbindliches Kaufangebot dar.
        Wertentwicklungen der Vergangenheit bieten keine Gewähr für zukünftige Ergebnisse.
        Der Wert von Anteilen und deren Erträge können fallen oder steigen.
        Maßgebliche Grundlage für einen Erwerb wären allein das aktuelle Basisinformationsblatt sowie der Verkaufsprospekt.
    </div>
    """, unsafe_allow_html=True)
