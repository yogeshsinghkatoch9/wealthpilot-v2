const { PrismaClient } = require('@prisma/client');
const stockData = require('./stockData');

const prisma = new PrismaClient();

/**
 * Portfolio Snapshot Service
 * Records and retrieves historical portfolio values for performance tracking
 */

/**
 * Record today's snapshot for a user
 */
async function recordDailySnapshot(userId) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all portfolios with holdings
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: { holdings: true }
    });

    if (portfolios.length === 0) return null;

    // Collect all symbols
    const allHoldings = portfolios.flatMap(p => p.holdings);
    if (allHoldings.length === 0) return null;

    const symbols = [...new Set(allHoldings.map(h => h.symbol))];

    // Get current prices
    const quotes = await stockData.getQuotes(symbols);

    // Calculate totals
    let totalValue = 0;
    let totalCost = 0;
    let totalDayGain = 0;

    allHoldings.forEach(h => {
      const quote = quotes[h.symbol] || { price: h.avgCostBasis, changeAmount: 0 };
      totalValue += h.shares * quote.price;
      totalCost += h.shares * h.avgCostBasis;
      totalDayGain += h.shares * (quote.changeAmount || 0);
    });

    // Upsert snapshot
    const snapshot = await prisma.portfolioSnapshot.upsert({
      where: {
        userId_date: { userId, date: today }
      },
      update: {
        totalValue,
        totalCost,
        dayGain: totalDayGain
      },
      create: {
        userId,
        date: today,
        totalValue,
        totalCost,
        dayGain: totalDayGain
      }
    });

    console.log(`[Snapshot] Recorded for user ${userId}: $${totalValue.toFixed(2)}`);
    return snapshot;
  } catch (error) {
    console.error('[Snapshot Error]', error.message);
    return null;
  }
}

/**
 * Get performance history for a user
 * @param {string} userId
 * @param {number} days - Number of days to fetch (default 365)
 */
async function getPerformanceHistory(userId, days = 365) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);

  const snapshots = await prisma.portfolioSnapshot.findMany({
    where: {
      userId,
      date: { gte: startDate }
    },
    orderBy: { date: 'asc' }
  });

  return snapshots;
}

/**
 * Generate historical snapshots based on stock history
 * Called when user first adds holdings to backfill data
 */
async function generateHistoricalSnapshots(userId, days = 365) {
  try {
    // Get all portfolios with holdings
    const portfolios = await prisma.portfolio.findMany({
      where: { userId },
      include: { holdings: true }
    });

    const allHoldings = portfolios.flatMap(p => p.holdings);
    if (allHoldings.length === 0) return [];

    const symbols = [...new Set(allHoldings.map(h => h.symbol))];

    // Fetch historical data for all symbols
    const historicalData = {};
    for (const symbol of symbols) {
      const history = await prisma.stockHistory.findMany({
        where: { symbol },
        orderBy: { date: 'asc' },
        take: days
      });
      historicalData[symbol] = history;
    }

    // Generate snapshots for each day we have data
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const snapshots = [];

    for (let i = days; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      let totalValue = 0;
      let totalCost = 0;
      let prevDayValue = 0;
      let hasData = false;

      for (const holding of allHoldings) {
        const history = historicalData[holding.symbol] || [];

        // Find the closest price for this date
        const dayData = history.find(h => {
          const hDate = new Date(h.date);
          hDate.setHours(0, 0, 0, 0);
          return hDate.getTime() === date.getTime();
        });

        if (dayData) {
          hasData = true;
          totalValue += holding.shares * dayData.close;
          totalCost += holding.shares * holding.avgCostBasis;

          // Find previous day for day gain calculation
          const prevDate = new Date(date);
          prevDate.setDate(prevDate.getDate() - 1);
          const prevData = history.find(h => {
            const hDate = new Date(h.date);
            hDate.setHours(0, 0, 0, 0);
            return hDate.getTime() === prevDate.getTime();
          });
          if (prevData) {
            prevDayValue += holding.shares * prevData.close;
          } else {
            prevDayValue += holding.shares * dayData.close;
          }
        } else {
          // Use cost basis if no historical data
          totalValue += holding.shares * holding.avgCostBasis;
          totalCost += holding.shares * holding.avgCostBasis;
          prevDayValue += holding.shares * holding.avgCostBasis;
        }
      }

      if (hasData || i === 0) {
        const dayGain = totalValue - prevDayValue;

        try {
          const snapshot = await prisma.portfolioSnapshot.upsert({
            where: {
              userId_date: { userId, date }
            },
            update: { totalValue, totalCost, dayGain },
            create: { userId, date, totalValue, totalCost, dayGain }
          });
          snapshots.push(snapshot);
        } catch (err) {
          // Skip duplicate errors
        }
      }
    }

    console.log(`[Snapshot] Generated ${snapshots.length} historical snapshots for user ${userId}`);
    return snapshots;
  } catch (error) {
    console.error('[Historical Snapshot Error]', error.message);
    return [];
  }
}

/**
 * Record snapshots for all users (for scheduled jobs)
 */
async function recordAllUserSnapshots() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true }
  });

  console.log(`[Snapshot] Recording daily snapshots for ${users.length} users`);

  for (const user of users) {
    await recordDailySnapshot(user.id);
  }
}

module.exports = {
  recordDailySnapshot,
  getPerformanceHistory,
  generateHistoricalSnapshots,
  recordAllUserSnapshots
};
