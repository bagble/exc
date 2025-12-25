function getTimeToNext(interval: number): number {
    const now = Date.now();
    return interval - (now % interval);
}

function startTimer(ms: number, callback: () => void): () => void {
    let timeoutId: NodeJS.Timeout;

    const executeTask = () => {
        callback();
        timeoutId = setTimeout(executeTask, getTimeToNext(ms));
    };

    timeoutId = setTimeout(executeTask, getTimeToNext(ms));

    return () => clearTimeout(timeoutId);
}

export { startTimer };