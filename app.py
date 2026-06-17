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
    padding-top: 1rem;
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
    font-size: 15px;
    margin-top: -8px;
}

.divider {
    height: 1px;
    background: #334155;
    margin: 18px 0 22px 0;
}

.metric-card {
    background: #111827;
    padding: 18px;
    border-radius: 16px;
    border: 1px solid #334155;
    margin-bottom: 12px;
}

.metric-label {
    font-size: 14px;
    color: #94a3b8;
}

.metric-value {
    font-size: 28px;
    color: #38bdf8;
    font-weight: 800;
}

.stTabs [data-baseweb="tab"] {
    background: #111827;
    border-radius: 12px;
    padding: 10px 14px;
    border: 1px solid #334155;
}

.stTabs [aria-selected="true"] {
    background: #1e293b;
    border: 1px solid #38bdf8;
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


PORTFOLIO = {
    "NVDA": 9.5,
    "MSFT": 10.0,
    "AMZN": 8.0,
    "GOOGL": 8.0,
    "META": 7.0,
    "TSM": 7.0,
    "AVGO": 6.0,
    "AMD": 5.0,
    "ASML": 5.0,
    "PLTR": 5.0,
    "TSLA": 4.0,
    "NOW": 4.0,
    "CRWD": 3.0,
    "ISRG": 3.0,
    "CRM": 2.0,
    "SNOW": 2.0,
    "SYM": 2.0,
    "TER": 1.0,
    "ROK": 1.0,
    "QCOM": 1.0,
    "AAPL": 1.0,
    "6954.T": 1.0,
    "PATH": 1.0,
    "KGX.DE": 0.5,
    "INTC": 0.5
}

ANTEILSPREIS_START = 25.00
AUSGABEAUFSCHLAG = 0.045
LAUFENDE_KOSTEN = 0.0198


def euro(value):
    return f"{value:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


@st.cache_data(ttl=3600)
def load_backtest():
    tickers = list(PORTFOLIO.keys())

    try:
        data = yf.download(
            tickers,
            period="5y",
            auto_adjust=True,
            progress=False
        )

        prices = data["Close"].dropna(axis=1, how="all")
        returns = prices.pct_change().dropna()

        available = list(returns.columns)

        weights = pd.Series({
            ticker: PORTFOLIO[ticker] for ticker in available
        })

        weights = weights / weights.sum()

        portfolio_returns = returns[available].dot(weights)

        daily_fee = LAUFENDE_KOSTEN / 252
        portfolio_returns_net = portfolio_returns - daily_fee

        index = (1 + portfolio_returns_net).cumprod() * 100
        index.iloc[0] = 100

        days = (index.index[-1] - index.index[0]).days
        cagr = (index.iloc[-1] / index.iloc[0]) ** (365 / days) - 1
        volatility = portfolio_returns_net.std() * np.sqrt(252)

        current_share_price = ANTEILSPREIS_START * (index.iloc[-1] / 100)

        return index, cagr, volatility, current_share_price, available

    except Exception:
        dates = pd.date_range(end=pd.Timestamp.today(), periods=60, freq="M")
        values = np.linspace(100, 165, len(dates))
        index = pd.Series(values, index=dates)

        return index, 0.105, 0.22, 41.25, list(PORTFOLIO.keys())


index, cagr, volatility, current_share_price, available_tickers = load_backtest()

df_portfolio = pd.DataFrame({
    "Ticker": list(PORTFOLIO.keys()),
    "Gewichtung": list(PORTFOLIO.values())
}).sort_values("Gewichtung", ascending=False)


# Header
col1, col2 = st.columns([1, 3])

with col1:
    st.image("logo.png", width=95)

with col2:
    st.markdown("""
    <h1 style="font-size:28px; margin-bottom:4px;">
        NextGen Robotics AI & Tech Fund
    </h1>
    <p class="subtitle">
        Digitale Fondsplattform · historische Simulation des Musterportfolios
    </p>
    """, unsafe_allow_html=True)

st.markdown('<div class="divider"></div>', unsafe_allow_html=True)

tab1, tab2, tab3, tab4 = st.tabs([
    "🏠 Übersicht",
    "🚀 Investieren",
    "💼 Dashboard",
    "📊 Portfolio"
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
            <div class="metric-label">Simulierter Anteilspreis</div>
            <div class="metric-value">{euro(current_share_price)}</div>
        </div>
        """, unsafe_allow_html=True)

    fig, ax = plt.subplots(figsize=(7, 4))
    fig.patch.set_facecolor("#111827")
    ax.set_facecolor("#111827")

    ax.plot(index.index, index.values, color="#38bdf8", linewidth=2.5)
    ax.fill_between(index.index, index.values, 100, color="#38bdf8", alpha=0.18)

    ax.set_title("Backtest des Musterportfolios", color="white")
    ax.set_ylabel("Indexiert auf 100", color="white")
    ax.tick_params(colors="white", labelsize=8)
    ax.grid(alpha=0.18)

    st.pyplot(fig)

    st.caption(
        "Backtest mit heutigen Gewichtungen des Musterportfolios, abzüglich laufender Kosten von 1,98 % p.a. "
        "Vergangene Wertentwicklung ist keine Garantie für zukünftige Ergebnisse."
    )


with tab2:
    st.markdown("## Fondsanteile kaufen")

    betrag = st.number_input(
        "Investitionsbetrag (€)",
        min_value=100,
        max_value=50000,
        value=1000,
        step=100
    )

    ausgabeaufschlag = betrag * AUSGABEAUFSCHLAG
    nettobetrag = betrag - ausgabeaufschlag
    anteile = nettobetrag / current_share_price

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Ausgabeaufschlag 4,50 %</div>
        <div class="metric-value">{euro(ausgabeaufschlag)}</div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Investierter Nettobetrag</div>
        <div class="metric-value">{euro(nettobetrag)}</div>
    </div>
    """, unsafe_allow_html=True)

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Fondsanteile</div>
        <div class="metric-value">{anteile:.2f}</div>
    </div>
    """, unsafe_allow_html=True)

    if st.button("Jetzt investieren"):
        st.success(f"Order erfasst: {euro(nettobetrag)} wurden in {anteile:.2f} Fondsanteile investiert.")

    st.caption("Demo-Modus: Es findet keine echte Orderausführung statt.")


with tab3:
    st.markdown("## Mein Dashboard")

    investiert = 5000
    anteile_demo = investiert / ANTEILSPREIS_START
    depotwert = anteile_demo * current_share_price
    gewinn = depotwert - investiert
    performance = gewinn / investiert * 100

    c1, c2 = st.columns(2)

    with c1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Depotwert</div>
            <div class="metric-value">{euro(depotwert)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Performance</div>
            <div class="metric-value">{performance:+.2f} %</div>
        </div>
        """, unsafe_allow_html=True)

    c3, c4 = st.columns(2)

    with c3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Investiert</div>
            <div class="metric-value">{euro(investiert)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Wertzuwachs</div>
            <div class="metric-value">{euro(gewinn)}</div>
        </div>
        """, unsafe_allow_html=True)

    scaled_values = index / 100 * investiert

    fig2, ax2 = plt.subplots(figsize=(7, 4))
    fig2.patch.set_facecolor("#111827")
    ax2.set_facecolor("#111827")

    ax2.plot(scaled_values.index, scaled_values.values, color="#38bdf8", linewidth=2.5)
    ax2.fill_between(scaled_values.index, scaled_values.values, investiert, color="#38bdf8", alpha=0.18)

    ax2.set_title("Simulierte Depotentwicklung", color="white")
    ax2.set_ylabel("Depotwert (€)", color="white")
    ax2.tick_params(colors="white", labelsize=8)
    ax2.grid(alpha=0.18)

    ax2.get_yaxis().set_major_formatter(
        plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
    )

    st.pyplot(fig2)


with tab4:
    st.markdown("## Portfolio")

    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Anzahl Positionen</div>
        <div class="metric-value">{len(PORTFOLIO)}</div>
    </div>
    """, unsafe_allow_html=True)

    fig3, ax3 = plt.subplots(figsize=(7, 6))
    fig3.patch.set_facecolor("#111827")
    ax3.set_facecolor("#111827")

    top = df_portfolio.head(15).sort_values("Gewichtung")

    ax3.barh(top["Ticker"], top["Gewichtung"], color="#38bdf8")
    ax3.set_xlabel("Gewichtung (%)", color="white")
    ax3.set_title("Top 15 Positionen", color="white")
    ax3.tick_params(colors="white", labelsize=8)
    ax3.grid(axis="x", alpha=0.18)

    for i, value in enumerate(top["Gewichtung"]):
        ax3.text(value + 0.1, i, f"{value:.1f}%", color="white", va="center", fontsize=8)

    st.pyplot(fig3)

    st.dataframe(df_portfolio, use_container_width=True)
