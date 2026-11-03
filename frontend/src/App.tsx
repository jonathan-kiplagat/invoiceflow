import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "@/components/Toast";
import { Spinner } from "@/components/ui";
import { AppProvider, useApp } from "@/hooks/useApp";
import AppLayout from "@/layouts/AppLayout";

const Login = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("@/pages/Auth").then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Invoices = lazy(() => import("@/pages/Invoices"));
const DocumentEditor = lazy(() => import("@/pages/DocumentEditor"));
const InvoiceDetail = lazy(() => import("@/pages/InvoiceDetail"));
const Quotations = lazy(() => import("@/pages/Quotations"));
const QuotationDetail = lazy(() => import("@/pages/QuotationDetail"));
const Customers = lazy(() => import("@/pages/Customers"));
const CustomerDetail = lazy(() => import("@/pages/CustomerDetail"));
const Payments = lazy(() => import("@/pages/Payments"));
const Reports = lazy(() => import("@/pages/Reports"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const SyncCenter = lazy(() => import("@/pages/SyncCenter"));
const PublicInvoice = lazy(() => import("@/pages/PublicInvoice"));
const NotFound = lazy(() => import("@/pages/NotFound"));

function FullPageSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, ready } = useApp();
  const location = useLocation();
  if (!ready) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, ready } = useApp();
  if (!ready) return <FullPageSpinner />;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppProvider>
          <Suspense fallback={<FullPageSpinner />}>
            <Routes>
              <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
              <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
              <Route path="/share/:token" element={<PublicInvoice />} />
              <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
                <Route index element={<Dashboard />} />
                <Route path="invoices" element={<Invoices />} />
                <Route path="invoices/new" element={<DocumentEditor kind="invoice" />} />
                <Route path="invoices/local/:localId" element={<DocumentEditor kind="invoice" />} />
                <Route path="invoices/:id" element={<InvoiceDetail />} />
                <Route path="invoices/:id/edit" element={<DocumentEditor kind="invoice" />} />
                <Route path="quotations" element={<Quotations />} />
                <Route path="quotations/new" element={<DocumentEditor kind="quotation" />} />
                <Route path="quotations/local/:localId" element={<DocumentEditor kind="quotation" />} />
                <Route path="quotations/:id" element={<QuotationDetail />} />
                <Route path="quotations/:id/edit" element={<DocumentEditor kind="quotation" />} />
                <Route path="customers" element={<Customers />} />
                <Route path="customers/:id" element={<CustomerDetail />} />
                <Route path="payments" element={<Payments />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="sync" element={<SyncCenter />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </AppProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
