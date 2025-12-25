<script lang="ts">
    import { m } from '$lib/paraglide/messages.js';
    import { getLocale } from "$lib/paraglide/runtime";
    import {onDestroy, onMount} from "svelte";
    import {
        CandlestickSeries,
        createChart,
        HistogramSeries,
        type IChartApi, type ISeriesApi, type LogicalRange, type UTCTimestamp
    } from "lightweight-charts";
    import {writable} from "svelte/store";
    import { fade } from 'svelte/transition';
    import {CurrencyFormatter, NumberFormatter, TimeFormatter, tzConvert} from "../../../../utils/format";
    import {isDarkMode} from "../../../../utils/Check";
    import {
        resetChart,
        toggleAutoScale,
        toggleFullScreen,
        toggleLogScale,
        toggleMagnet,
        toggleTheme
    } from "../../../../utils/Button";
    import {intervalToMilliseconds} from "../../../../utils/timestamp";
    import {safe} from "@orpc/client";
    import {rpc} from "$lib/client/rpc";
    import { applyMovingAverageIndicator } from "$lib/client/charts/indicators/moving-avarage";

    type ChartData = {
        symbol: string;
        interval: number;
        currency: string;
        utcOffset: number;
        ma: number[];
    };

    const { data } = $props<{ data: ChartData }>();

    let symbol = $state(data.symbol);

    const session = writable<any>({});
    const symbolData = writable<any>({});
    const chart = writable<any>([]);
    let unsubscribe: () => void;

    let loaded = $state(false);
    let latestPrice = $state(0);
    let oldDataLoaded = $state(true);

    let doNotLoad = false; // 차트 로딩 중지 플래그

    let chartWorker: Worker;

    onMount(() => {
        chartWorker = new Worker(new URL('$lib/client/workers/chart_worker.ts', import.meta.url), {
            type: 'module',
            name: 'Chart Worker'
        });
        chartWorker.postMessage({
            type: 'connect',
            symbol: symbol,
            interval: data.interval,
            session: true,
            info: true,
            depth: false,
            ledger: false,
            chart: true
        });

        chartWorker.onmessage = (event) => {
            if (event.data.type === 'session') {
                session.set(event.data.data);
            } else if (event.data.type === 'info') {
                symbolData.set(event.data.data);
            } else if (event.data.type === 'chart') {
                console.log('Chart data received:', event.data.data);
                chart.set(event.data.data);
            } else if (event.data.type === 'error') {
                const json = event.data.data;
                if (json["error"].includes("Invalid symbol")) {
                    popover.innerHTML = m['Chart.symbol_not_found']({ symbol: symbol });
                } else if (json["error"].includes("interval")) {
                    popover.innerHTML = m['Chart.invalid_interval']({ interval: data.interval });
                }
                doNotLoad = true;
                popover.showPopover();
            }
        };

        chartWorker.onerror = (event) => {
            // console.error('Chart Worker Error:', event.message);
            doNotLoad = true;
            popover.innerHTML = m['Chart.failed_to_load_chart']({ error: event.message });
            popover.showPopover();
        };

        return () => {
            chartWorker.postMessage({type: 'disconnect'});
            chartWorker.terminate();
            doNotLoad = true;
            if (unsubscribe) unsubscribe();
        };
    });

    let ohlcv = $derived({
        symbol: symbol,
        open: "",
        high: "",
        low: "",
        close: "",
        volume: "",
    });

    let chart_status = $state('gray'); // green, red, gray
    $effect(() => {
        if ($symbolData.status && $symbolData.status.status === "suspended") {
            chart_status = 'red';

            popover.innerHTML = m['Chart.symbol_suspended']({ symbol: symbol, reason: $symbolData.status.reason || m['Chart.symbol_suspended_no_reason']() });
            popover.showPopover();
        } else if ($symbolData.status && $symbolData.status.status === "inactive") {
            chart_status = 'gray';
        } else {
            switch ($session.session) {
                case "pre":
                    chart_status = 'orange';
                    break;
                case "regular":
                    chart_status = 'green';
                    break;
                case "post":
                    chart_status = 'blue';
                    break;
                default:
                    chart_status = 'gray';
                    break;
            }
        }
    });

    let chartContainer: HTMLDivElement;
    let legend: HTMLDivElement;
    let chartE: IChartApi;
    let candleE: ISeriesApi<"Candlestick">;
    let volumeE: ISeriesApi<"Histogram">;

    let popover: HTMLDivElement;

    if (!doNotLoad) {
        // 최초 1회만 실행
        onMount(async () => {
            const chart = createChart(chartContainer, {
                localization: {
                    locale: getLocale(),
                    // dateFormat: "yyyy-MM-dd",
                    timeFormatter: (timestamp: number) => {
                        const date = new Date(timestamp * 1000);
                        return TimeFormatter(date, getLocale(), intervalToMilliseconds(data.interval));
                    }
                },
                rightPriceScale: {
                    visible: true,
                    borderColor: '#d6dcde'
                },
                leftPriceScale: {
                    visible: false,
                    borderColor: '#d6dcde',
                },
                timeScale: {
                    barSpacing: 15,
                    rightOffset: 5,
                    borderColor: '#d6dcde',
                    timeVisible: intervalToMilliseconds(data.interval) < 86400000, // 1일 이상 간격이면 시간 숨김
                },
                crosshair: {
                    mode: 0,
                    horzLine: {
                        labelBackgroundColor: '#202027',
                    },
                    vertLine: {
                        labelBackgroundColor: '#202027',
                    },
                },
            });

            const candle = chart.addSeries(CandlestickSeries, {
                priceFormat: {
                    type: 'custom',
                    formatter: (price: number) => CurrencyFormatter(price, getLocale(), data.currency),
                    minMove: 0.01,
                },
                upColor: "#f04452",
                downColor: "#3182f6",
                borderUpColor: "#f04452",
                borderDownColor: "#3182f6",
                wickUpColor: "#f04452",
                wickDownColor: "#3182f6",
            });

            candle.priceScale().applyOptions({
                scaleMargins: {
                    top: 0.1,
                    bottom: 0.25,
                },
            })

            const volume = chart.addSeries(HistogramSeries, {
                priceFormat: {
                    type: 'volume'
                },
                priceScaleId: '',
            });

            volume.priceScale().applyOptions({
                scaleMargins: {
                    top: 0.85,
                    bottom: 0,
                },
            });

            const colors = ['red', 'orange', 'green', 'blue', 'purple', 'black'];
            let maIndex = 0;
            for (const maPeriod of data.ma) {
                const ma = applyMovingAverageIndicator(candle, {
                    length: maPeriod,
                    smoothingLine: "EMA",
                    source: "close"
                });
                ma.applyOptions({
                    color: colors[maIndex % colors.length],
                    lineWidth: 1,
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false,
                });

                maIndex += 1;
            }

            let loadedCandlesCount = 0;
            async function getMoreChart(range: LogicalRange | null) {
                if (range && range.from <= -10) {
                    if (loadedCandlesCount > 20000) {
                        chart.timeScale().unsubscribeVisibleLogicalRangeChange(getMoreChart);
                        return;
                    }
                    if (!oldDataLoaded || !loaded) return; // 이전 로드가 완료되지 않았으면 중단
                    oldDataLoaded = false; // 로드 중 상태로 변경

                    // console.log("과거 데이터 로드 중...");

                    // 변환된 timezone을 고려하여 원본 timestamp 계산
                    const oldestTime = tzConvert(Number(candle.data()[0].time) * 1000, -data.utcOffset);

                    const [__, result] = await safe(
                        rpc.chart.getTop({
                            symbol: symbol,
                            interval: data.interval,
                            timestamp: oldestTime - 1,
                            count: 500,
                        })
                    )

                    if (result!.chart && result!.chart.length > 0) {
                        const moreCandles: {
                            time: UTCTimestamp;
                            open: number;
                            high: number;
                            low: number;
                            close: number;
                        }[] = [];
                        const moreVolumes: { time: UTCTimestamp; value: number; color: string; }[] = [];
                        result!.chart.map((c: any) => {
                            moreCandles.push({
                                time: tzConvert(c.timestamp, data.utcOffset) / 1000 as UTCTimestamp,
                                open: c.open,
                                high: c.high,
                                low: c.low,
                                close: c.close,
                            });
                            moreVolumes.push({
                                time: tzConvert(c.timestamp, data.utcOffset) / 1000 as UTCTimestamp,
                                value: c.volume,
                                color: c.close >= c.open ? 'rgba(240,68,82,0.5)' : 'rgba(49,130,246,0.5)',
                            });
                        });
                        candle.setData([...moreCandles, ...candle.data()]);
                        volume.setData([...moreVolumes, ...volume.data()]);

                        loadedCandlesCount += result!.chart.length;
                        // console.log("과거 데이터 로드 완료:", result!.chart.length, "개");
                    } else {
                        // 더 이상 불러올 데이터가 없음
                        // console.log("더 이상 불러올 과거 데이터가 없습니다.");
                        chart.timeScale().unsubscribeVisibleLogicalRangeChange(getMoreChart);
                    }
                    oldDataLoaded = true; // 로드 완료 상태로 변경
                }
            }

            // legend 설정
            legend.style.color = isDarkMode(chart) ? 'white' : 'black';

            const safeSet = (next: any) => {
                ohlcv = {
                    symbol: next.symbol,
                    open: next.open,
                    high: next.high,
                    low: next.low,
                    close: next.close,
                    volume: next.volume,
                }
            };

            const makeObj = (c: any, v: any) => {
                if (!c || !v) {
                    return {symbol: symbol, open: "", high: "", low: "", close: "", volume: ""};
                }
                return {
                    symbol: symbol,
                    open: CurrencyFormatter(c.open, getLocale(), data.currency),
                    high: CurrencyFormatter(c.high, getLocale(), data.currency),
                    low: CurrencyFormatter(c.low, getLocale(), data.currency),
                    close: CurrencyFormatter(c.close, getLocale(), data.currency),
                    volume: NumberFormatter(v.value, getLocale())
                };
            };

            let isCrosshairInside = false;

            const updateLastBar = () => {
                const cSeries = candle;
                const vSeries = volume;
                if (!cSeries || !vSeries) return;
                const cArr = cSeries.data();
                const vArr = vSeries.data();
                if (!cArr.length || !vArr.length) return;
                safeSet(makeObj(cArr[cArr.length - 1], vArr[vArr.length - 1]));
            };

            const wrapLiveUpdates = () => {
                const c = candle;
                const v = volume;
                if (!c || !v) return;

                const originalUpdates = new WeakMap<any, (bar: any) => void>();

                const wrap = (series: any) => {
                    if (!originalUpdates.has(series)) {
                        originalUpdates.set(series, series.update.bind(series));
                        series.update = (bar: any) => {
                            originalUpdates.get(series)!(bar);
                            if (!isCrosshairInside) updateLastBar();
                        };
                    }
                };

                wrap(c);
                wrap(v);
            };

            const handleCrosshair = (param: any) => {
                const cSeries = candle;
                const vSeries = volume;
                if (!cSeries || !vSeries) return;

                if (!param.point || !param.time) {
                    isCrosshairInside = false;
                    updateLastBar();
                    return;
                }

                const candleData = param.seriesData.get(cSeries);
                const volumeData = param.seriesData.get(vSeries);
                if (candleData && volumeData) {
                    isCrosshairInside = true;
                    safeSet(makeObj(candleData, volumeData));
                }
            };
            chart.subscribeCrosshairMove(handleCrosshair);
            wrapLiveUpdates();

            const initialPollId = setTimeout(() => {
                const c = candle;
                const v = volume;
                if (!c || !v) return;
                const cArr = c.data();
                const vArr = v.data();
                if (cArr.length && vArr.length) {
                    updateLastBar();
                    clearTimeout(initialPollId);
                }
            }, 50);

            // 차트의 크기를 조정
            const resize = () => {
                chart.resize(window.innerWidth, window.innerHeight);
            }

            // 키보드 이벤트 리스너
            let isTempMagnetActive = false;
            const handleKeyDown = (event: any) => {
                // Crtl + Shift + D : 테마 토글
                if (event.ctrlKey && event.shiftKey && event.code === 'KeyD') {
                    toggleTheme(chart);
                }

                // Crtl : 자석모드 임시 토글
                if (event.ctrlKey && !isTempMagnetActive) {
                    isTempMagnetActive = true;
                    toggleMagnet(chart);
                }

                // Alt + Shift + M : 자석모드 토글
                if (event.altKey && event.shiftKey && event.code === 'KeyM') {
                    toggleMagnet(chart);
                }

                // Alt + R : 차트 리셋
                if (event.altKey && event.code === 'KeyR') {
                    resetChart(chart);
                }

                // A : 오토 스케일 토글
                if (event.code === 'KeyA') {
                    toggleAutoScale(chart);
                }

                // L : 로그 스케일 토글
                if (event.code === 'KeyL') {
                    toggleLogScale(chart);
                }

                // F : 전체 화면 모드 토글
                if (event.code === 'KeyF') {
                    toggleFullScreen();
                }
            }

            const handleKeyUp = (event: any) => {
                if (event.code === 'ControlLeft' || event.code === 'ControlRight') {
                    if (isTempMagnetActive) {
                        isTempMagnetActive = false;
                        toggleMagnet(chart);
                    }
                }
            }

            window.addEventListener('resize', resize);
            chart.timeScale().subscribeVisibleLogicalRangeChange(getMoreChart);
            chartContainer.addEventListener('keydown', handleKeyDown);
            chartContainer.addEventListener('keyup', handleKeyUp);

            chartE = chart;
            candleE = candle;
            volumeE = volume;

            onDestroy(() => {
                chart.timeScale().unsubscribeVisibleLogicalRangeChange(getMoreChart);
                chart.remove();
                window.removeEventListener('resize', resize);
                chartContainer.removeEventListener('keydown', handleKeyDown);
                chartContainer.removeEventListener('keyup', handleKeyUp);
                clearTimeout(initialPollId);
            });
        });

        onMount(() => {
            let pendingUpdates: any[] = [];


            unsubscribe = chart.subscribe((chartData) => {
                if (!candleE || !volumeE) return;

                if (chartData.type === "init") {
                    if (loaded) return;

                    let latestTimestamp = 0;
                    if (chartData.chart.length === 0) {
                        candleE.setData([]);
                        volumeE.setData([]);
                        latestPrice = 0;
                    } else {
                        const candles: {
                            time: UTCTimestamp;
                            open: number;
                            high: number;
                            low: number;
                            close: number;
                        }[] = [];
                        const volumes: { time: UTCTimestamp; value: number; color: string; }[] = [];
                        chartData.chart.forEach((c: any) => {
                            candles.push({
                                time: tzConvert(c.timestamp, data.utcOffset) / 1000 as UTCTimestamp,
                                open: c.open,
                                high: c.high,
                                low: c.low,
                                close: c.close,
                            });
                            volumes.push({
                                time: tzConvert(c.timestamp, data.utcOffset) / 1000 as UTCTimestamp,
                                value: c.volume,
                                color: c.close >= c.open ? 'rgba(240,68,82,0.5)' : 'rgba(49,130,246,0.5)',
                            });
                        });
                        candleE.setData(candles);
                        volumeE.setData(volumes);
                        latestPrice = candles[candles.length - 1]?.close ?? 0;
                        latestTimestamp = chartData.chart[chartData.chart.length - 1]?.timestamp ?? 0;
                    }
                    for (const update of pendingUpdates) {
                        if (update.timestamp < latestTimestamp) continue;
                        const newTime = tzConvert(update.timestamp, data.utcOffset) / 1000;
                        candleE.update({
                            time: newTime as UTCTimestamp,
                            open: update.open,
                            high: update.high,
                            low: update.low,
                            close: update.close,
                        });
                        volumeE.update({
                            time: newTime as UTCTimestamp,
                            value: update.volume,
                            color: update.close >= update.open ? 'rgba(240,68,82,0.5)' : 'rgba(49,130,246,0.5)',
                        });
                        latestPrice = update.close;
                    }
                    pendingUpdates = [];
                    loaded = true;
                }

                if (chartData.type === "update" && chartData.chart.length > 0) {
                    if (!loaded) {
                        pendingUpdates.push(chartData.chart[0]);
                        return;
                    }

                    const lastCandle = candleE.data()[candleE.data().length - 1];
                    const newTime = tzConvert(chartData.chart[0].timestamp, data.utcOffset) / 1000;
                    if (lastCandle && Number(lastCandle.time) > Number(newTime)) return;
                    chartData.chart.forEach((c: any) => {
                        const convertedTime = tzConvert(c.timestamp, data.utcOffset) / 1000;
                        candleE.update({
                            time: convertedTime as UTCTimestamp,
                            open: c.open,
                            high: c.high,
                            low: c.low,
                            close: c.close,
                        });
                        volumeE.update({
                            time: convertedTime as UTCTimestamp,
                            value: c.volume,
                            color: c.close >= c.open ? 'rgba(240,68,82,0.5)' : 'rgba(49,130,246,0.5)',
                        });
                        latestPrice = c.close;
                    });

                }
            });
        });
    }
</script>

<div bind:this={popover} popover class="flex text-xl font-bold text-center text-red-500 select-none border border-black" style="padding:8px; position:absolute; top:50%; left:50%; transform:translate(-50%, -50%);"></div>

{#if !loaded}
    <div class="loading-overlay" transition:fade>
        {m['Chart.loading_chart']()}
    </div>
{/if}

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div id="chart-container" tabindex={0} role="application" style="position:fixed; inset:0; width:100%; height:100%; overflow:hidden;" bind:this={chartContainer}>
    <div id="symbol" class="legend" bind:this={legend}>
        {@html m['Chart.symbol_ohlcv']({
            ...ohlcv,
            status: `<svg width="28" height="28" style="vertical-align: middle; margin-left: -4px; margin-right: -4px; display:inline;">
                <circle fill="${chart_status}" cx="13" cy="13" r="6"/>
            </svg>`,
        })}
    </div>
</div>

<style>
    .legend {
        position: absolute;
        font-size: 14px;
        left: 12px;
        top: 12px;
        z-index: 10;
        font-family: sans-serif;
        line-height: 18px;
        font-weight: 300;
        user-select: none;
        touch-action: none;
    }

    @media (max-width: 700px) {
        .legend {
            font-size: 12px;
        }
    }

    .loading-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background-color: white;
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        pointer-events: auto;
        user-select: none;
        touch-action: none;
    }
</style>