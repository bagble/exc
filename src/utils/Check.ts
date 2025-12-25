import type {IChartApi} from "lightweight-charts";

function isDarkMode(chart: IChartApi): boolean {
    const bg = chart.options().layout.background;
    if (bg.type === 'solid') {
        return bg.color === '#17171c';
    }
    return false;
}

function isMagnetMode(chart: IChartApi): boolean {
  return chart.options().crosshair.mode === 3;
}

export { isDarkMode, isMagnetMode };