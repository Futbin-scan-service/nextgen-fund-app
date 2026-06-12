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
    padding-bottom: 1rem;
    max-width: 1500px;
}

.stApp {
    background: radial-gradient(circle at top, #172033 0%, #0b1020 55%, #030712 100%);
    color: white;
}

h1, h2, h3, p, label, span {
    color: #f1f5f9;
}

.small-text {
    color: #a8b3c7;
    font-size: 18px;
    margin-top: -10px;
}

.neon-line {
    height: 3px;
    background: linear-gradient(90deg, #7c3aed, #22d3ee, #7c3aed);
    border-radius: 20px;
    margin: 18px 0 28px 0;
    box-shadow: 0 0 18px rgba(34, 211, 238, 0.65);
}

.card {
    background: linear-gradient(145deg, rgba(15,23,42,0.96), rgba(17,24,39,0.92));
    padding: 24px;
    border-radius: 22px;
    border: 1px solid #334155;
    box-shadow: 0 0 30px rgba(0,0,0,0.35);
}

.logo-card {
    background: linear-gradient(145deg, #0f172a, #111827);
    padding: 14px;
    border-radius: 18px;
    border: 1px solid #7c3aed;
    box-shadow: 0 0 24px rgba(124,58,237,0.55);
    text-align: center;
}

.metric-card {
    background: linear-gradient(135deg, #111827, #1e1b4b);
    padding: 22px;
    border-radius: 20px;
    border: 1px solid #7c3aed;
    box-shadow: 0 0 20px rgba(34, 211, 238, 0.22);
}

.metric-label {
    font-size: 16px;
    color: #cbd5e1;
    margin-bottom: 10px;
}

.metric-value {
    font-size: 34px;
    color: #22d3ee;
    font-weight: 800;
}

.stSlider, .stRadio {
    background: rgba(15,23,42,0.9);
    padding: 18px;
    border-radius: 18px;
    border: 1px solid #334155;
    margin-bottom: 16px;
}

div[data-testid="stExpander"] {
    background: rgba(15,23,42,0.9);
    border-radius: 18px;
    border: 1px solid #334155;
}
</style>
""", unsafe_allow_html=True)


@st.cache_data
def load_data():
    try:
        return pd.read_csv("fonds.csv")
    except Exception:
        return pd.DataFrame({
            "Symbol": ["NVDA", "MSFT", "AMZN", "GOOGL", "META", "ASML", "PLTR"],
            "Allocation": [9.0, 8.5, 6.25, 6.25, 4.5, 4.0, 3.5]
        })


def euro(value):
    return f"{value:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


df = load_data()

# Header
col_logo, col_title = st.columns([1.1, 7])

with col_logo:
    st.markdown('<div class="logo-card">', unsafe_allow_html=True)
    st.image("logo.png", use_container_width=True)
    st.markdown('</div>', unsafe_allow_html=True)

with col_title:
    st.markdown("""
    <h1 style="font-size:48px; margin-bottom:8px;">
        NextGen Robotics AI & Tech Fund
    </h1>
    <p class="small-text">
        Berechne in Sekunden, wie sich regelmäßiges Investieren langfristig entwickeln könnte.
    </p>
    """, unsafe_allow_html=True)

st.markdown('<div class="neon-line"></div>', unsafe_allow_html=True)

# Layout
left, right = st.columns([1, 2.45])

with left:
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.markdown("<h2>⚙️ Rechner</h2>", unsafe_allow_html=True)

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
        value=7,
        step=1
    )

    rendite_option = st.radio(
        "Erwartete Rendite",
        [
            "Konservativ: 7 % p.a.",
            "Optimistisch: 10 % p.a.",
            "Tech/Growth-Fokus: 12 % p.a."
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
    st.markdown("<h2>💰 Ergebnis</h2>", unsafe_allow_html=True)

    c1, c2, c3 = st.columns(3)

    with c1:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Depotwert</div>
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

    with c3:
        st.markdown(f"""
        <div class="metric-card">
            <div class="metric-label">Gewinn</div>
            <div class="metric-value">{euro(profit)}</div>
        </div>
        """, unsafe_allow_html=True)

    fig, ax = plt.subplots(figsize=(13, 5.8))
    fig.patch.set_facecolor("#111827")
    ax.set_facecolor("#111827")

    ax.fill_between(
        years_axis,
        invested_history,
        color="#7c3aed",
        alpha=0.9,
        label="Einzahlungen"
    )

    ax.fill_between(
        years_axis,
        invested_history,
        values_history,
        color="#22d3ee",
        alpha=0.85,
        label="Zinseszins / Gewinn"
    )

    ax.set_xlabel("Jahre", color="white", fontsize=12)
    ax.set_ylabel("Betrag (€)", color="white", fontsize=12)
    ax.tick_params(colors="white")
    ax.grid(alpha=0.22)

    ax.get_yaxis().set_major_formatter(
        plt.FuncFormatter(lambda x, loc: f"{int(x):,} €".replace(",", "."))
    )

    ax.legend(loc="upper left")
    ax.set_xlim(0, jahre)

    st.pyplot(fig)

    st.caption(
        "Hinweis: Dies ist eine vereinfachte Modellrechnung und keine Anlageberatung. "
        "Zukünftige Renditen sind nicht garantiert."
    )

    st.markdown('</div>', unsafe_allow_html=True)

st.markdown("")

with st.expander("📊 Fondszusammensetzung anzeigen"):
    df_sorted = df.sort_values(by="Allocation", ascending=True)
    top_holdings = df_sorted.tail(15)

    fig2, ax2 = plt.subplots(figsize=(12, 5))
    fig2.patch.set_facecolor("#111827")
    ax2.set_facecolor("#111827")

    bars = ax2.barh(
        top_holdings["Symbol"],
        top_holdings["Allocation"],
        color="#22d3ee"
    )

    ax2.set_xlabel("Gewichtung im Fonds (%)", color="white")
    ax2.set_title("Top 15 Holdings unseres Fonds", color="white")
    ax2.tick_params(colors="white")
    ax2.grid(axis="x", alpha=0.2)

    for bar in bars:
        width = bar.get_width()
        ax2.text(
            width + 0.1,
            bar.get_y() + bar.get_height() / 2,
            f"{width}%",
            va="center",
            ha="left",
            fontsize=9,
            fontweight="bold",
            color="white"
        )

    st.pyplot(fig2)