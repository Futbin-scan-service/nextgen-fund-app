import streamlit as st
import pandas as pd
import matplotlib.pyplot as plt
import base64

st.set_page_config(
    page_title="NextGen Fund",
    page_icon="📈",
    layout="centered"
)

st.markdown("""
<style>
header {visibility: hidden;}
footer {visibility: hidden;}

.block-container {
    padding-top: 0.6rem;
    padding-left: 1rem;
    padding-right: 1rem;
    max-width: 520px;
}

.stApp {
    background: radial-gradient(circle at top, #172033 0%, #0b1020 55%, #030712 100%);
    color: white;
}

h1, h2, h3, p, label, span {
    color: #f1f5f9;
}

.logo-animate {
    animation:
        logoIntro 1.1s ease-out,
        logoGlow 2.4s ease-in-out infinite alternate;
}

@keyframes logoIntro {
    0% {
        opacity: 0;
        transform: scale(0.75) translateY(-12px);
        filter: blur(6px);
    }
    100% {
        opacity: 1;
        transform: scale(1) translateY(0);
        filter: blur(0);
    }
}

@keyframes logoGlow {
    from {
        filter: drop-shadow(0 0 6px rgba(124,58,237,0.45));
    }
    to {
        filter: drop-shadow(0 0 18px rgba(34,211,238,0.75));
    }
}

.title-animate {
    animation: titleIntro 1.1s ease-out;
}

@keyframes titleIntro {
    0% {
        opacity: 0;
        transform: translateX(18px);
    }
    100% {
        opacity: 1;
        transform: translateX(0);
    }
}

.neon-line {
    height: 3px;
    background: linear-gradient(90deg, #7c3aed, #22d3ee, #7c3aed);
    background-size: 200% 100%;
    border-radius: 20px;
    margin: 14px 0 22px 0;
    box-shadow: 0 0 18px rgba(34, 211, 238, 0.65);
    animation: neonFlow 4s linear infinite;
}

@keyframes neonFlow {
    from {
        background-position: 0% 50%;
    }
    to {
        background-position: 200% 50%;
    }
}

.metric-card {
    background: linear-gradient(135deg, #111827, #1e1b4b);
    padding: 18px;
    border-radius: 18px;
    border: 1px solid #7c3aed;
    box-shadow: 0 0 18px rgba(34, 211, 238, 0.25);
    margin-bottom: 12px;
}

.metric-label {
    font-size: 15px;
    color: #cbd5e1;
}

.metric-value {
    font-size: 32px;
    color: #22d3ee;
    font-weight: 800;
    margin-top: 4px;
}

.stSlider, .stSelectbox {
    background: rgba(15,23,42,0.9);
    padding: 14px;
    border-radius: 16px;
    border: 1px solid #334155;
    margin-bottom: 14px;
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


def image_to_base64(path):
    with open(path, "rb") as file:
        return base64.b64encode(file.read()).decode()


df = load_data()
logo_base64 = image_to_base64("logo.png")

logo_col, title_col = st.columns([1, 2.2])

with logo_col:
    st.markdown(f"""
    <img
        class="logo-animate"
        src="data:image/png;base64,{logo_base64}"
        style="width:105px; max-width:100%;">
    """, unsafe_allow_html=True)

with title_col:
    st.markdown("""
    <div class="title-animate" style="
        font-size: 25px;
        font-weight: 800;
        line-height: 1.12;
        padding-top: 10px;
        color: #ffffff;
    ">
        NextGen Robotics<br>
        AI & Tech Fund
    </div>
    """, unsafe_allow_html=True)

st.markdown('<div class="neon-line"></div>', unsafe_allow_html=True)

st.markdown("## ⚙️ Rechner")

monatlicher_betrag = st.slider(
    "Monatliche Sparrate (€)",
    min_value=10,
    max_value=500,
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

rendite_option = st.selectbox(
    "Erwartete Rendite",
    [
        "Konservativ: 7 % p.a.",
        "Optimistisch: 10 % p.a.",
        "Tech/Growth-Fokus: 12 % p.a."
    ],
    index=2
)

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

st.markdown("## 💰 Ergebnis")

st.markdown(f"""
<div class="metric-card">
    <div class="metric-label">Möglicher Depotwert</div>
    <div class="metric-value">{euro(total_value)}</div>
</div>
""", unsafe_allow_html=True)

col_a, col_b = st.columns(2)

with col_a:
    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Einzahlungen</div>
        <div class="metric-value" style="font-size:22px;">{euro(total_invested)}</div>
    </div>
    """, unsafe_allow_html=True)

with col_b:
    st.markdown(f"""
    <div class="metric-card">
        <div class="metric-label">Gewinn</div>
        <div class="metric-value" style="font-size:22px;">{euro(profit)}</div>
    </div>
    """, unsafe_allow_html=True)

fig, ax = plt.subplots(figsize=(5.2, 3.7))
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
    label="Gewinn"
)

ax.set_xlabel("Jahre", color="white", fontsize=9)
ax.set_ylabel("€", color="white", fontsize=9)
ax.tick_params(colors="white", labelsize=8)
ax.grid(alpha=0.22)

ax.get_yaxis().set_major_formatter(
    plt.FuncFormatter(lambda x, loc: f"{int(x):,}".replace(",", "."))
)

ax.legend(loc="upper left", fontsize=8)
ax.set_xlim(0, jahre)

st.pyplot(fig)

st.caption(
    "Hinweis: Vereinfachte Modellrechnung. Keine Anlageberatung. "
    "Zukünftige Renditen sind nicht garantiert."
)

with st.expander("📊 Fondszusammensetzung anzeigen"):
    df_sorted = df.sort_values(by="Allocation", ascending=True)
    top_holdings = df_sorted.tail(10)

    fig2, ax2 = plt.subplots(figsize=(5.2, 3.8))
    fig2.patch.set_facecolor("#111827")
    ax2.set_facecolor("#111827")

    bars = ax2.barh(
        top_holdings["Symbol"],
        top_holdings["Allocation"],
        color="#22d3ee"
    )

    ax2.set_xlabel("Gewichtung (%)", color="white", fontsize=9)
    ax2.set_title("Top Holdings", color="white", fontsize=11)
    ax2.tick_params(colors="white", labelsize=8)
    ax2.grid(axis="x", alpha=0.2)

    for bar in bars:
        width = bar.get_width()
        ax2.text(
            width + 0.1,
            bar.get_y() + bar.get_height() / 2,
            f"{width}%",
            va="center",
            ha="left",
            fontsize=8,
            color="white"
        )

    st.pyplot(fig2)
