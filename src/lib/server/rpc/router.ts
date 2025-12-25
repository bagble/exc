import * as symbols from "$lib/server/rpc/public/symbols";
import * as users from "$lib/server/rpc/public/users";
import * as devices from "$lib/server/rpc/public/devices";
import * as orders from "$lib/server/rpc/public/trades/orders";
import * as ledgers from "$lib/server/rpc/public/trades/ledgers";
import * as chart from "$lib/server/rpc/public/trades/chart";
import * as notify from "$lib/server/rpc/public/trades/notify";
import * as session from "$lib/server/rpc/public/session";
// import * as portfolios from "$lib/server/rpc/portfolios";

export const publicRouter = {
    symbols: {
        get: symbols.getSymbol,
        getAll: symbols.getAllSymbols,
        getAdmin: symbols.getSymbolAdmin,
        getAllAdmin: symbols.getAllSymbolsAdmin,
        listing: symbols.listingSymbol,
        inactivate: symbols.inactivateSymbol,
        updateStatus: symbols.updateSymbolStatus,
        update: symbols.updateSymbol,
    },
    users: {
        getProfile: users.getMyProfile,
        updateProfile: users.updateMyProfile,
        register: users.registerUser,
        login: users.loginUser,
        logout: users.logoutUser,
        get: users.getUser,
        getAll: users.getAllUsers,
        create: users.createUser,
        update: users.updateUserByID,
        activate: users.activateUserByID,
        deactivate: users.deactivateUserByID,
        recoveryToken: users.createRecoveryToken,
        validToken: users.isRecoveryTokenValid,
        resetPassword: users.recoveryPassword,
        resendEmail: users.resendVerificationEmail,
        verifyEmail: users.verifyEmail,
    },
    devices: {
        check: devices.checkDevice,
        register: devices.registerDevice,
    },
    orders: {
        get: orders.getOrders,
        create: orders.createOrder,
        modify: orders.modifyOrder,
        cancel: orders.cancelOrder,
    },
    ledgers: {
        get: ledgers.fetchLedger
    },
    chart: {
        get: chart.fetchChartData,
        getTop: chart.fetchChartDataTop,
        timestamp: chart.getChartTimestamp,
    },
    notify: {
        getOrder: notify.fetchOrderNotify
    },
    portfolios: {

    },
    session: {
        now: session.nowSession
    }
}

export const privateRouter = {
    ...publicRouter,
}