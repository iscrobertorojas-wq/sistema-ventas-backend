import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { RowDataPacket } from 'mysql2';
import { withAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async function GET() {
    try {
        // Get current date info
        const now = new Date();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());
        startOfWeek.setHours(0, 0, 0, 0);

        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfYear = new Date(now.getFullYear(), 0, 1);

        const dateStr = startOfMonth.toISOString().split('T')[0];
        const weekStr = startOfWeek.toISOString().split('T')[0];
        const yearStr = startOfYear.toISOString().split('T')[0];

        // Execute all queries in parallel for better performance
        const [
            [weekStats],
            [monthStats],
            [yearStats],
            [pendingStats],
            [monthlyIncome],
            [salesByMonth],
            [topClients],
            [statusDistribution],
            [monthPurchases],
            [purchasesByMonth],
            [paymentsByMonth]
        ] = await Promise.all([
            pool.query<RowDataPacket[]>('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM Sales WHERE date >= ?', [weekStr]),
            pool.query<RowDataPacket[]>('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM Sales WHERE date >= ?', [dateStr]),
            pool.query<RowDataPacket[]>('SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM Sales WHERE date >= ?', [yearStr]),
            pool.query<RowDataPacket[]>(`
                SELECT COUNT(*) as count, COALESCE(SUM(s.total - COALESCE(p.paid, 0)), 0) as total
                FROM Sales s
                LEFT JOIN (SELECT sale_id, SUM(amount) as paid FROM Payments GROUP BY sale_id) p ON s.id = p.sale_id
                WHERE s.total > COALESCE(p.paid, 0)
            `),
            pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(amount), 0) as total FROM Payments WHERE date >= ? AND date <= LAST_DAY(?)', [dateStr, dateStr]),
            pool.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(date, '%Y-%m') as month, COUNT(*) as count, COALESCE(SUM(total), 0) as total
                FROM Sales
                WHERE date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY month
                ORDER BY month ASC
            `),
            pool.query<RowDataPacket[]>(`
                SELECT c.name, COUNT(s.id) as sales_count, COALESCE(SUM(s.total), 0) as total
                FROM Clients c
                JOIN Sales s ON c.id = s.client_id
                GROUP BY c.id, c.name
                ORDER BY total DESC
                LIMIT 5
            `),
            pool.query<RowDataPacket[]>(`
                SELECT status, COUNT(*) as count FROM Sales GROUP BY status
            `),
            pool.query<RowDataPacket[]>('SELECT COALESCE(SUM(total), 0) as total, COUNT(*) as count FROM Purchases WHERE date >= ? AND date <= LAST_DAY(?)', [dateStr, dateStr]),
            pool.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(date, '%Y-%m') as month, COALESCE(SUM(total), 0) as total
                FROM Purchases
                WHERE date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY month
                ORDER BY month ASC
            `),
            pool.query<RowDataPacket[]>(`
                SELECT DATE_FORMAT(date, '%Y-%m') as month, COALESCE(SUM(amount), 0) as total
                FROM Payments
                WHERE date >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                GROUP BY month
                ORDER BY month ASC
            `)
        ]);

        return NextResponse.json({
            week: weekStats[0],
            month: monthStats[0],
            year: yearStats[0],
            pending: pendingStats[0],
            monthlyIncome: monthlyIncome[0],
            monthPurchases: monthPurchases[0],
            salesByMonth,
            topClients,
            statusDistribution,
            purchasesByMonth,
            paymentsByMonth
        });
    } catch (error: any) {
        console.error('Error fetching stats:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
});
