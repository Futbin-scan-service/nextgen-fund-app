import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt

st.set_page_config(
    page_title="NextGen Robotics AI & Tech Fund",
    page_icon="📈",
    layout="wide"
)

st.markdown("""
<style>
header {visibility: hidden;}
footer {visibility: hidden;}

.block-container {
    padding-top: 1rem;
    padding-bottom: 2rem;
    max-width: 1400px;
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
    font-size: 17px;
    margin-top: -8px;
}

.divider {
    height: 1px;
    background: #334155;
    margin: 22px 0 28px 0;
}

.card {
    background: #111827;
    padding: 24px;
    border-radius: 18px;
    border: 1px solid #334155;
    box-shadow: 0 8px 24px rgba(0,0,0,0.25);
    margin-bottom: 18px;
}

.metric-card {
    background: #0f172a;
    padding: 22px;
    border-radius: 16px;
    border: 1px solid #334155;
    margin-bottom: 14px;
}

.metric-label {
    font-size: 15px;
    color: #94a3b8;
    margin-bottom: 8px;
}

.metric-value {
    font-size: 32px;
    color: #38bdf8;
    font-weight: 800;
}

.note {
    color: #94a3b8;
    font-size: 14px;
}

.stTabs [data-baseweb="tab-list"] {
    gap: 12px;
}

.stTabs [data-baseweb="tab"] {
    background: #111827;
    border-radius: 14px;
    padding: 12px 18px;
    border: 1px solid #334155;
}

.stTabs [aria-selected="true"] {
    background: #1e293b;
    border: 1px solid #38bdf8;
}

.stSlider, .stRadio, .stNumberInput {
    background: #111827;
    padding: 16px;
    border-radius: 14px;
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

.stButton > button:hover {
    background: #0284c7;
}
</style>
""", unsafe_allow_html=True)


@st.cache_data
def load_data():
    try:
        return pd.read_csv("fonds.csv")
    except Exception:
        return pd.DataFrame({
            "Symbol": ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "SAP", "ORCL", "NVDA", "ASML", "PLTR"],
            "Allocation": [8.87, 8.22, 8.18, 7.28, 5.86, 4.78, 4.76, 4.50, 4.30, 2.67]
        })


def euro(value):
    return f"{value:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


df = load_data()

# Header
col_logo, col_title = st.columns([1, 6])

with col_logo:
    st.image("logo.png", width=120)

with col_title:
    st.markdown("""
    <h1 style="font-size:42px; margin-bottom:6px;">
        NextGen Robotics AI & Tech Fund
    </h1>
    <p class="subtitle">
        Digitale Fondsplattform · Demo für Investment, Portfolio und Performance
    </p>
    """, unsafe_allow_html=True)

st.markdown('<div class="divider"></div>', unsafe_allow_html=True)

tab1, tab2, tab3, tab4 = st.tabs([
    "🏠 Übersicht",
    "🚀 Investieren",
    "💼 Dashboard",
    "📊 Portfolio"
])

# TAB 1: Übersicht / Rechner
with tab1:
    left, right = st.columns([1, 2])

    with left:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("## Sparplan-Rechner")

        monatlicher_betrag = st.slider(
            "Monatliche Sparrate (€)",
            min_value=10,
            max_value=1000,
            value=50,
            step=10
        )

        jahre = st.slider(
            "Anlagezeitraum (Jahre)",
            min_value=1,
            max_value=40,
            value=20,
            step=1
        )

        rendite_option = st.radio(
            "Modellannahme",
            [
                "Marktszenario: 7 % p.a.",
                "Wachstumsszenario: 10 % p.a.",
                "NextGen-Modellportfolio: 12 % p.a."
            ],
            index=2
        )

        st.markdown('</div>', unsafe_allow_html=True)

    if "7 %" in rendite_option:
        r_annual = 0.07
    elif "10 %" in rendite_option:
        r_annual = 0.10
    else:
        r_annual = 0.12

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
    years_axis = list(range(0, len(values_history)))

    with right:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("## Prognose")

        c1, c2, c3 = st.columns(3)

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
                <div class="metric-label">Investiertes Kapital</div>
                <div class="metric-value">{euro(total_invested)}</div>
            </div>
            """, unsafe_allow_html=True)

        with c3:
            st.markdown(f"""
            <div class="metric-card">
                <div class="metric-label">Wertzuwachs</div>
                <div class="metric-value">{euro(profit)}</div>
            </div>
            """, unsafe_allow_html=True)

        fig, ax = plt.subplots(figsize=(11, 4.8))
        fig.patch.set_facecolor("#111827")
        ax.set_facecolor("#111827")

        ax.fill_between(
            years_axis,
            invested_history,
            color="#64748b",
            alpha=0.85,
            label="Investiertes Kapital"
        )

        ax.fill_between(
            years_axis,
            invested_history,
            values_history,
            color="#38bdf8",
            alpha=0.75,
            label="Vermögensentwicklung"
        )

        ax.set_xlabel("Jahre", color="white")
        ax.set_ylabel("Betrag (€)", color="white")
        ax.tick_params(colors="white")
        ax.grid(alpha=0.18)

        ax.get_yaxis().set_major_formatter(
            plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
        )

        ax.legend(loc="upper left")
        ax.set_xlim(0, jahre)

        st.pyplot(fig)

        st.caption(
            "Hinweis: Vereinfachte Modellrechnung. Keine Anlageberatung. "
            "Zukünftige Renditen sind nicht garantiert."
        )

        st.markdown('</div>', unsafe_allow_html=True)

# TAB 2: Investieren
with tab2:
    col1, col2 = st.columns([1, 1.4])

    with col1:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("## Fondsanteile kaufen")

        anteilspreis = 25.00

        betrag = st.number_input(
            "Investitionsbetrag (€)",
            min_value=100,
            max_value=50000,
            value=1000,
            step=100
        )

        anteile = betrag / anteilspreis

        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Rücknahmepreis / Anteil</div>
            <div class="metric-value">{euro(anteilspreis)}</div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Voraussichtliche Fondsanteile</div>
            <div class="metric-value">{anteile:.2f}</div>
        </div>
        """, unsafe_allow_html=True)

        gekauft = st.button("Jetzt investieren")

        if gekauft:
            st.success(f"Order erfolgreich erfasst: {euro(betrag)} in {anteile:.2f} Fondsanteile.")

        st.caption("Demo-Modus: Es findet keine echte Orderausführung statt.")

        st.markdown('</div>', unsafe_allow_html=True)

    with col2:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("## Orderübersicht")

        ausgabeaufschlag = betrag * 0.045
        nettobetrag = betrag - ausgabeaufschlag
        netto_anteile = nettobetrag / anteilspreis

        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Bruttobetrag</div>
            <div class="metric-value">{euro(betrag)}</div>
        </div>
        """, unsafe_allow_html=True)

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
            <div class="metric-label">Fondsanteile nach Kosten</div>
            <div class="metric-value">{netto_anteile:.2f}</div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown('</div>', unsafe_allow_html=True)

# TAB 3: Dashboard
with tab3:
    st.markdown("## Persönliches Dashboard")

    investiert = 5000
    aktueller_wert = 5735
    gewinn = aktueller_wert - investiert
    rendite = gewinn / investiert * 100
    anteile = investiert / 25.00

    c1, c2, c3, c4 = st.columns(4)

    with c1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Depotwert</div>
            <div class="metric-value">{euro(aktueller_wert)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c2:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Investiert</div>
            <div class="metric-value">{euro(investiert)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Wertzuwachs</div>
            <div class="metric-value">+{euro(gewinn)}</div>
        </div>
        """, unsafe_allow_html=True)

    with c4:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Performance</div>
            <div class="metric-value">+{rendite:.1f} %</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.markdown("## Performance seit Kauf")

    monate = list(range(0, 13))
    werte = [
        5000, 5060, 4985, 5120, 5210, 5180, 5300,
        5410, 5520, 5485, 5600, 5680, 5735
    ]

    fig3, ax3 = plt.subplots(figsize=(12, 4.8))
    fig3.patch.set_facecolor("#111827")
    ax3.set_facecolor("#111827")

    ax3.plot(monate, werte, linewidth=3, color="#38bdf8")
    ax3.fill_between(monate, werte, 5000, color="#38bdf8", alpha=0.18)

    ax3.set_xlabel("Monate", color="white")
    ax3.set_ylabel("Depotwert (€)", color="white")
    ax3.tick_params(colors="white")
    ax3.grid(alpha=0.18)

    ax3.get_yaxis().set_major_formatter(
        plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
    )

    st.pyplot(fig3)

    st.caption("Demo-Dashboard mit beispielhafter Wertentwicklung.")

    st.markdown('</div>', unsafe_allow_html=True)

# TAB 4: Portfolio
with tab4:
    st.markdown("## Portfolioübersicht")

    col1, col2 = st.columns([1.3, 1])

    with col1:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("### Top Holdings")

        df_sorted = df.sort_values(by="Allocation", ascending=True)
        top_holdings = df_sorted.tail(15)

        fig2, ax2 = plt.subplots(figsize=(10, 5))
        fig2.patch.set_facecolor("#111827")
        ax2.set_facecolor("#111827")

        bars = ax2.barh(
            top_holdings["Symbol"],
            top_holdings["Allocation"],
            color="#38bdf8"
        )

        ax2.set_xlabel("Gewichtung im Fonds (%)", color="white")
        ax2.set_title("Top 15 Positionen", color="white")
        ax2.tick_params(colors="white")
        ax2.grid(axis="x", alpha=0.18)

        for bar in bars:
            width = bar.get_width()
            ax2.text(
                width + 0.1,
                bar.get_y() + bar.get_height() / 2,
                f"{width}%",
                va="center",
                ha="left",
                fontsize=9,
                color="white"
            )

        st.pyplot(fig2)
        st.markdown('</div>', unsafe_allow_html=True)

    with col2:
        st.markdown('<div class="card">', unsafe_allow_html=True)
        st.markdown("### Fondsprofil")

        st.markdown("""
        <div class="metric-card">
            <div class="metric-label">Anlageschwerpunkt</div>
            <div class="metric-value" style="font-size:24px;">KI & Technologie</div>
        </div>

        <div class="metric-card">
            <div class="metric-label">Risikoklasse</div>
            <div class="metric-value" style="font-size:24px;">5 / 7</div>
        </div>

        <div class="metric-card">
            <div class="metric-label">Fondswährung</div>
            <div class="metric-value" style="font-size:24px;">EUR</div>
        </div>

        <div class="metric-card">
            <div class="metric-label">Ertragsverwendung</div>
            <div class="metric-value" style="font-size:24px;">Thesaurierend</div>
        </div>
        """, unsafe_allow_html=True)

        st.markdown('</div>', unsafe_allow_html=True)
