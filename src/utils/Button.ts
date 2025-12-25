import { isDarkMode } from "./Check";
import {ColorType, type IChartApi} from "lightweight-charts";

// Local functions
function lightMode(chart: IChartApi): void {
    chart.applyOptions({
        layout: {
            background: { type: ColorType.Solid, color: '#ffffff' },
            textColor: '#000000',
        },
        grid: {
            vertLines: { color: '#d6dcde' },
            horzLines: { color: '#d6dcde' },
        },
        crosshair: {
            horzLine: { labelBackgroundColor: '#202027' },
            vertLine: { labelBackgroundColor: '#202027' },
        },
        rightPriceScale: { borderColor: '#d6dcde' },
        leftPriceScale: { borderColor: '#d6dcde' },
        timeScale: { borderColor: '#d6dcde' }
    });

    const symbolEl = document.getElementById("symbol");
    if (symbolEl) {
        symbolEl.style.color = 'black';
    }
}

function darkMode(chart: IChartApi): void {
    chart.applyOptions({
        layout: {
            background: { type: ColorType.Solid, color: '#17171c' },
            textColor: '#ffffff',
        },
        grid: {
            vertLines: { color: '#202027' },
            horzLines: { color: '#202027' },
        },
        crosshair: {
            horzLine: { labelBackgroundColor: '#d6dcde' },
            vertLine: { labelBackgroundColor: '#d6dcde' },
        },
        rightPriceScale: { borderColor: '#202027' },
        leftPriceScale: { borderColor: '#202027' },
        timeScale: { borderColor: '#202027' }
    });

    const symbolEl = document.getElementById("symbol");
    if (symbolEl) {
        symbolEl.style.color = 'white';
    }
}

// Public functions
function toggleTheme(chart: IChartApi): void {
    if (!isDarkMode(chart)) {
        darkMode(chart);
        console.log("DEBUG: Dark mode activated");
    } else {
        lightMode(chart);
        console.log("DEBUG: Light mode activated");
    }
}

function toggleMagnet(chart: IChartApi): void {
    const current = chart.options().crosshair?.mode ?? 0;
    const magnet = current === 0 ? 3 : 0;
    chart.applyOptions({
        crosshair: { mode: magnet }
    });
    console.log(`DEBUG: Magnet mode ${magnet ? 'activated' : 'deactivated'}`);
}

function resetChart(chart: IChartApi): void {
    chart.applyOptions({ rightPriceScale: { autoScale: true } })
    chart.timeScale().resetTimeScale();
    console.log("DEBUG: Chart reset");
}

function toggleAutoScale(chart: IChartApi): void {
    const priceScale = chart.options().rightPriceScale || {};
    const newAutoScale = !priceScale.autoScale;
    chart.applyOptions({
        rightPriceScale: {
            ...priceScale,
            autoScale: newAutoScale,
        },
    });
    console.log(`DEBUG: Auto scale ${newAutoScale ? 'enabled' : 'disabled'}`);
}

function toggleLogScale(chart: IChartApi): void {
    const priceScale = chart.options().rightPriceScale || {};
    const newLogScale = !(priceScale.mode && priceScale.mode === 1);
    chart.applyOptions({
        rightPriceScale: {
            ...priceScale,
            mode: newLogScale ? 1 : 0
        },
    });
    console.log(`DEBUG: Log scale ${newLogScale ? 'enabled' : 'disabled'}`);
}

function toggleFullScreen(): void {
    const chartContainer = document.getElementById("chart-container");
    if (!chartContainer) {
        console.error("Chart container not found");
        return;
    }

    if (!document.fullscreenElement) {
        chartContainer.requestFullscreen()
            .then(() => console.log("DEBUG: Full screen mode activated"))
            .catch(err => {
                console.error(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
            });
    } else {
        document.exitFullscreen()
            .then(() => console.log("DEBUG: Full screen mode deactivated"))
            .catch(err => {
                console.error(`Error attempting to exit full-screen mode: ${err.message} (${err.name})`);
            });
    }
}

export {
    toggleTheme,
    toggleMagnet,
    resetChart,
    toggleAutoScale,
    toggleLogScale,
    toggleFullScreen
};