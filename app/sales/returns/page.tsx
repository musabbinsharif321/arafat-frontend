'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Shell } from '@/components/Shell';
import { api, TransactionData } from '@/lib/api';
import { 
  RotateCcw, Search, Plus, Package, User, DollarSign, FileText, X, 
  ShoppingCart, AlertCircle, Trash2, ArrowRight, CheckCircle2, RefreshCw, Calendar,
  Filter, ChevronUp, ChevronDown, ArrowLeft, Lightbulb, Printer, Edit2, Eye, Receipt,
  Check, ShieldAlert, Sparkles, ChevronLeft, ChevronRight, Banknote, CreditCard, Truck
} from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { format } from 'date-fns';
import { bn } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { toBengaliDigits, toEnglishDigits, formatProductName } from '@/lib/bengaliUtils';
import { CustomerSearchSelect } from '@/components/CustomerSearchSelect';
import { CascadingProductSelector, SelectedProductDetails } from '@/components/CascadingProductSelector';
import { ReturnInvoiceMemo } from '@/components/ReturnInvoiceMemo';
import { SalesReturnDetailsView } from '@/components/SalesReturnDetailsView';
import { BengaliDateRangePicker } from '@/components/ui/BengaliDateRangePicker';
import { printElement } from '@/lib/printUtils';
import { TableRowActionMenu } from '@/components/TableRowActionMenu';
import { useAuth } from '@/lib/authContext';

// Helpers for safe decimal inputs with Bengali numerals and preserving decimal points
const toBengaliInputDigits = (val: string): string => {
  if (!val) return '';
  const bnDigits: Record<string, string> = {
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
    '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯'
  };
  return val.replace(/[0-9]/g, m => bnDigits[m] || m);
};

const formatDecimalInput = (val: string): string => {
  if (!val) return '';
  const en = toEnglishDigits(val).replace(/[।\,]/g, '.');
  const clean = en.replace(/[^0-9.]/g, '');
  if (clean === '') return '';
  
  const parts = clean.split('.');
  let normalized = parts[0];
  if (parts.length > 1) {
    if (normalized === '') normalized = '0';
    normalized += '.' + parts.slice(1).join('');
  }
  return toBengaliInputDigits(normalized);
};

const parseInputNumber = (val: string | number | undefined | null): number => {
  if (val === undefined || val === null || val === '') return 0;
  const en = toEnglishDigits(String(val)).replace(/[^0-9.]/g, '');
  const n = parseFloat(en);
  return isNaN(n) ? 0 : n;
};

interface ReturnEntry {
  id: string;
  invoiceNo?: string;
  customerName: string;
  customerId: string;
  totalReturnValue: number;
  totalNewTakenValue?: number;
  netRefundValue: number;
  dueAdjusted: number;
  cashRefundPaid: number;
  paymentMethod?: string;
  bankAccountId?: string;
  returnedItems: ReturnItem[];
  newTakenItems?: ReturnItem[];
  reason: string;
  status?: string;
  createdAt: any;
  rodLaborRate?: number;
  rodLaborCost?: number;
  rodLoadingToCustomerLedger?: boolean;
  rodUnloadingRate?: number;
  rodUnloadingCost?: number;
  rodUnloadingToCustomerLedger?: boolean;
  cementLaborRate?: number;
  cementLaborCost?: number;
  cementLoadingToCustomerLedger?: boolean;
  cementUnloadingRate?: number;
  cementUnloadingCost?: number;
  cementUnloadingToCustomerLedger?: boolean;
  shippingCost?: number;
  shippingCostToCustomerLedger?: boolean;
  rodShippingRate?: number;
  cementShippingRate?: number;
  customerPayableCharges?: number;
  shopPaidCharges?: number;
}

interface ReturnItem {
  id: string;
  productId?: number | null;
  name: string;
  quantity: number;
  maxQuantity?: number;
  soldQuantity?: number;
  alreadyReturnedQty?: number;
  price: number;
  unit: string;
  condition?: 'good' | 'damaged';
  invoiceNo?: string;
}

interface Product {
  id: string;
  name: string;
  sellPrice: number;
  stock: number;
  unit: string;
}

interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  totalDue?: number;
}

const COMMON_REASONS = [
  'অতিরিক্ত মাল বেঁচে গেছে',
  'ভুল সাইজ/মিলি নেওয়া হয়েছিল',
  'পণ্য ভাঙা / ত্রুটিপূর্ণ ছিল',
  'কাস্টমারের কাজ সমাপ্ত/বাতিল',
];

export default function SalesReturnsPage() {
  const { canEditInvoice, canDeleteInvoice, canCreateInvoice, canApproveInvoice } = useAuth();
  const [returns, setReturns] = useState<ReturnEntry[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [filterType, setFilterType] = useState('সব');
  const [filterApprovalStatus, setFilterApprovalStatus] = useState<'all' | 'approved' | 'pending'>('all');
  const [isFilterExpanded, setIsFilterExpanded] = useState(false);
  const [minRefund, setMinRefund] = useState('');
  const [maxRefund, setMaxRefund] = useState('');

  const handleResetFilters = () => {
    setSearch('');
    setStartDate('');
    setEndDate('');
    setFilterType('সব');
    setFilterApprovalStatus('all');
    setMinRefund('');
    setMaxRefund('');
  };

  // Pagination States
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [printingReturn, setPrintingReturn] = useState<ReturnEntry | null>(null);
  
  // New Return Modal States
  const [isOpen, setIsOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [returnCart, setReturnCart] = useState<ReturnItem[]>([]);

  const [customerInvoices, setCustomerInvoices] = useState<any[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [itemCondition, setItemCondition] = useState<'good' | 'damaged'>('good');

  // Rate-based vs manual extra charge states (Matching sales invoices)
  const [chargeCalcMode, setChargeCalcMode] = useState<'rate' | 'manual'>('rate');
  const [rodLaborRateInput, setRodLaborRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_rod_labor_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [rodLoadingToCustomerLedger, setRodLoadingToCustomerLedger] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_rod_loading_to_customer');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const [rodUnloadingRateInput, setRodUnloadingRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_rod_unloading_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [rodUnloadingToCustomerLedger, setRodUnloadingToCustomerLedger] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_rod_unloading_to_customer');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const [cementLaborRateInput, setCementLaborRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_cement_labor_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [cementLoadingToCustomerLedger, setCementLoadingToCustomerLedger] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_cement_loading_to_customer');
      if (saved !== null) return saved === 'true';
    }
    return false;
  });
  const [cementUnloadingRateInput, setCementUnloadingRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_cement_unloading_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [cementUnloadingToCustomerLedger, setCementUnloadingToCustomerLedger] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_cement_unloading_to_customer');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const [shippingCostToCustomerLedger, setShippingCostToCustomerLedger] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_shipping_to_customer');
      if (saved !== null) return saved === 'true';
    }
    return true;
  });
  const [shippingCostInput, setShippingCostInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_shipping_cost');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [rodShippingRateInput, setRodShippingRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_rod_shipping_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });
  const [cementShippingRateInput, setCementShippingRateInput] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('dokan_sales_cement_shipping_rate');
      return saved ? formatDecimalInput(saved) : '';
    }
    return '';
  });

  const [rodLaborTotalInput, setRodLaborTotalInput] = useState<string>('');
  const [rodUnloadingTotalInput, setRodUnloadingTotalInput] = useState<string>('');
  const [cementLaborTotalInput, setCementLaborTotalInput] = useState<string>('');
  const [cementUnloadingTotalInput, setCementUnloadingTotalInput] = useState<string>('');

  const [reason, setReason] = useState('');
  const [cashRefundInput, setCashRefundInput] = useState(0);

  // Payment / Cash Refund Entry States
  const [banks, setBanks] = useState<any[]>([]);
  const [cashRefundPaidInput, setCashRefundPaidInput] = useState<number>(0);
  const [settlementMode, setSettlementMode] = useState<'due_adjust' | 'cash' | 'custom'>('due_adjust');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank' | 'mobile_banking'>('cash');
  const [bankAccountId, setBankAccountId] = useState<string>('');

  // Fetch Banks
  useEffect(() => {
    api.banks.list().then(res => setBanks(res || [])).catch(() => setBanks([]));
  }, []);

  // View, Edit, Delete States
  const [selectedReturn, setSelectedReturn] = useState<ReturnEntry | null>(null);
  const [isPrintMemoOpen, setIsPrintMemoOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<ReturnEntry | null>(null);
  const [deletingReturn, setDeletingReturn] = useState<ReturnEntry | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Helper to extract clean product name
  const cleanProdName = (str: string) => {
    if (!str) return '';
    return str.replace(/\s*\[ড্যামেজ\]/g, '').replace(/\s*\(ইনভ:[^)]+\)/g, '').trim().toLowerCase();
  };

  // Helper to get already returned quantity for an item in an invoice
  const getAlreadyReturnedQty = useCallback((invNo?: string, productId?: string | number | null, prodName?: string, excludeReturnId?: string) => {
    if (!invNo) return 0;
    const targetIdStr = productId ? String(productId) : '';
    const targetCleanName = prodName ? cleanProdName(prodName) : '';

    return returns.reduce((sum, ret) => {
      if (excludeReturnId && String(ret.id) === String(excludeReturnId)) return sum;
      if (ret.invoiceNo && ret.invoiceNo !== invNo) return sum;

      const matchedItems = (ret.returnedItems || []).filter(item => {
        if (targetIdStr && item.id && String(item.id) === targetIdStr) return true;
        if (targetCleanName && cleanProdName(item.name) === targetCleanName) return true;
        return false;
      });

      const returnedInThis = matchedItems.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
      return sum + returnedInThis;
    }, 0);
  }, [returns]);

  // Helper to get returnable items breakdown for an invoice
  const getInvoiceReturnableStatus = (inv: any) => {
    const items = inv.items || [];
    let returnableCount = 0;
    const totalSoldItems = items.length;
    let fullyReturnedCount = 0;

    items.forEach((item: any) => {
      const soldQty = Number(item.quantity || 1);
      const alreadyReturned = getAlreadyReturnedQty(inv.invoice_no, item.product || item.id, item.product_name || item.name, editingReturn?.id);
      const remaining = Math.max(0, soldQty - alreadyReturned);
      if (remaining > 0) {
        returnableCount++;
      } else {
        fullyReturnedCount++;
      }
    });

    return {
      totalSoldItems,
      returnableCount,
      fullyReturnedCount,
      isFullyReturned: totalSoldItems > 0 && returnableCount === 0
    };
  };

  // Function to load all items of an invoice into the return cart
  const loadInvoiceItemsIntoReturnCart = useCallback((invoice: any) => {
    if (!invoice || !invoice.items || invoice.items.length === 0) {
      toast.info('এই মেমোতে কোনো পণ্য পাওয়া যায়নি');
      setReturnCart([]);
      return;
    }

    const mapped: ReturnItem[] = [];
    let zeroRemainingCount = 0;

    invoice.items.forEach((item: any, idx: number) => {
      const soldQty = Number(item.quantity || 1);

      // Resolve valid Product ID if one exists in products list
      const rawProdId = (item.product && typeof item.product === 'object')
        ? item.product.id
        : item.product;

      let validProdId: number | null = null;
      if (rawProdId && !isNaN(Number(rawProdId)) && products.some(p => Number(p.id) === Number(rawProdId))) {
        validProdId = Number(rawProdId);
      } else {
        const cleanName = cleanProdName(item.product_name || item.name);
        const matched = products.find(p => cleanProdName(p.name) === cleanName);
        if (matched) {
          validProdId = Number(matched.id);
        }
      }

      const alreadyReturned = getAlreadyReturnedQty(invoice.invoice_no, validProdId || item.product_name || item.name, item.product_name || item.name, editingReturn?.id);
      const remainingReturnable = Math.max(0, soldQty - alreadyReturned);

      if (remainingReturnable <= 0) {
        zeroRemainingCount++;
      } else {
        mapped.push({
          id: `ret-item-${idx}-${item.id || Date.now()}`,
          productId: validProdId,
          name: formatProductName(item.product_name || item.name),
          quantity: remainingReturnable,
          maxQuantity: remainingReturnable,
          soldQuantity: soldQty,
          alreadyReturnedQty: alreadyReturned,
          price: Number(item.price || 0),
          unit: item.unit || 'পিস',
          condition: itemCondition,
          invoiceNo: invoice.invoice_no || ''
        });
      }
    });

    setReturnCart(mapped);

    if (mapped.length === 0) {
      toast.warning(`⚠️ মেমো #${invoice.invoice_no || invoice.id}-এর সমস্ত পণ্য ইতিমধ্যে ফেরত নেওয়া হয়ে গেছে! কোনো পণ্য অবশিষ্ট নেই।`);
    } else if (zeroRemainingCount > 0) {
      toast.info(`মেমো #${invoice.invoice_no || invoice.id}-এর অবশিষ্ট (${toBengaliDigits(mapped.length)}টি) ফেরতযোগ্য পণ্য লোড হয়েছে (${toBengaliDigits(zeroRemainingCount)}টি পূর্বেই ফেরত সম্পন্ন)`);
    } else {
      toast.success(`মেমো #${invoice.invoice_no || invoice.id}-এর সকল (${toBengaliDigits(mapped.length)}টি) পণ্য ফেরত তালিকায় লোড হয়েছে`);
    }
  }, [getAlreadyReturnedQty, editingReturn?.id, itemCondition]);

  // Fetch Customer Invoices when customer is selected
  useEffect(() => {
    let isSubscribed = true;
    if (selectedCustomerId) {
      const custNum = Number(selectedCustomerId);
      api.transactions.list({ transaction_type: 'sale', party: !isNaN(custNum) ? custNum : undefined })
        .then(res => {
          if (!isSubscribed) return;
          const list = res || [];
          setCustomerInvoices(list);
          if (list.length > 0) {
            const firstInv = list[0];
            setSelectedInvoiceId(String(firstInv.id));
            if (!editingReturn && firstInv.items?.length) {
              loadInvoiceItemsIntoReturnCart(firstInv);
            }
          } else {
            setSelectedInvoiceId('');
            setReturnCart([]);
          }
          setLoadingInvoices(false);
        })
        .catch(err => {
          if (!isSubscribed) return;
          console.error('Error fetching customer invoices:', err);
          setCustomerInvoices([]);
          setLoadingInvoices(false);
        });
    }
    return () => {
      isSubscribed = false;
    };
  }, [selectedCustomerId, editingReturn, loadInvoiceItemsIntoReturnCart]);

  const resetChargeInputs = () => {
    if (typeof window !== 'undefined') {
      const rLabor = localStorage.getItem('dokan_sales_rod_labor_rate');
      setRodLaborRateInput(rLabor ? formatDecimalInput(rLabor) : '');
      const rLoadCust = localStorage.getItem('dokan_sales_rod_loading_to_customer');
      setRodLoadingToCustomerLedger(rLoadCust !== null ? rLoadCust === 'true' : true);
      const rUnload = localStorage.getItem('dokan_sales_rod_unloading_rate');
      setRodUnloadingRateInput(rUnload ? formatDecimalInput(rUnload) : '');
      const rUnloadCust = localStorage.getItem('dokan_sales_rod_unloading_to_customer');
      setRodUnloadingToCustomerLedger(rUnloadCust !== null ? rUnloadCust === 'true' : true);
      const cLabor = localStorage.getItem('dokan_sales_cement_labor_rate');
      setCementLaborRateInput(cLabor ? formatDecimalInput(cLabor) : '');
      const cLoadCust = localStorage.getItem('dokan_sales_cement_loading_to_customer');
      setCementLoadingToCustomerLedger(cLoadCust !== null ? cLoadCust === 'true' : false);
      const cUnload = localStorage.getItem('dokan_sales_cement_unloading_rate');
      setCementUnloadingRateInput(cUnload ? formatDecimalInput(cUnload) : '');
      const cUnloadCust = localStorage.getItem('dokan_sales_cement_unloading_to_customer');
      setCementUnloadingToCustomerLedger(cUnloadCust !== null ? cUnloadCust === 'true' : true);
      const shipCust = localStorage.getItem('dokan_sales_shipping_to_customer');
      setShippingCostToCustomerLedger(shipCust !== null ? shipCust === 'true' : true);
      const rShip = localStorage.getItem('dokan_sales_rod_shipping_rate');
      setRodShippingRateInput(rShip ? formatDecimalInput(rShip) : '');
      const cShip = localStorage.getItem('dokan_sales_cement_shipping_rate');
      setCementShippingRateInput(cShip ? formatDecimalInput(cShip) : '');
      setShippingCostInput('');
    }
    setRodLaborTotalInput('');
    setRodUnloadingTotalInput('');
    setCementLaborTotalInput('');
    setCementUnloadingTotalInput('');
  };

  const handleEditReturn = (entry: ReturnEntry) => {
    setEditingReturn(entry);
    setSelectedCustomerId(entry.customerId || '');
    setReturnCart(entry.returnedItems || []);
    setReason(entry.reason || '');
    setCashRefundPaidInput(entry.cashRefundPaid || 0);
    setPaymentMethod(((entry.paymentMethod as any) || 'cash'));
    setBankAccountId(entry.bankAccountId || '');
    if (entry.rodLaborRate !== undefined) setRodLaborRateInput(formatDecimalInput(String(entry.rodLaborRate)));
    if (entry.rodLaborCost !== undefined) setRodLaborTotalInput(formatDecimalInput(String(entry.rodLaborCost)));
    if (entry.rodLoadingToCustomerLedger !== undefined) setRodLoadingToCustomerLedger(entry.rodLoadingToCustomerLedger);
    if (entry.rodUnloadingRate !== undefined) setRodUnloadingRateInput(formatDecimalInput(String(entry.rodUnloadingRate)));
    if (entry.rodUnloadingCost !== undefined) setRodUnloadingTotalInput(formatDecimalInput(String(entry.rodUnloadingCost)));
    if (entry.rodUnloadingToCustomerLedger !== undefined) setRodUnloadingToCustomerLedger(entry.rodUnloadingToCustomerLedger);
    if (entry.cementLaborRate !== undefined) setCementLaborRateInput(formatDecimalInput(String(entry.cementLaborRate)));
    if (entry.cementLaborCost !== undefined) setCementLaborTotalInput(formatDecimalInput(String(entry.cementLaborCost)));
    if (entry.cementLoadingToCustomerLedger !== undefined) setCementLoadingToCustomerLedger(entry.cementLoadingToCustomerLedger);
    if (entry.cementUnloadingRate !== undefined) setCementUnloadingRateInput(formatDecimalInput(String(entry.cementUnloadingRate)));
    if (entry.cementUnloadingCost !== undefined) setCementUnloadingTotalInput(formatDecimalInput(String(entry.cementUnloadingCost)));
    if (entry.cementUnloadingToCustomerLedger !== undefined) setCementUnloadingToCustomerLedger(entry.cementUnloadingToCustomerLedger);
    if (entry.shippingCost !== undefined) setShippingCostInput(formatDecimalInput(String(entry.shippingCost)));
    if (entry.shippingCostToCustomerLedger !== undefined) setShippingCostToCustomerLedger(entry.shippingCostToCustomerLedger);
    if (entry.rodShippingRate !== undefined) setRodShippingRateInput(formatDecimalInput(String(entry.rodShippingRate)));
    if (entry.cementShippingRate !== undefined) setCementShippingRateInput(formatDecimalInput(String(entry.cementShippingRate)));

    if ((entry.cashRefundPaid || 0) > 0 && (entry.dueAdjusted || 0) > 0) {
      setSettlementMode('custom');
    } else if ((entry.cashRefundPaid || 0) > 0) {
      setSettlementMode('cash');
    } else {
      setSettlementMode('due_adjust');
    }
    setIsOpen(true);
  };

  const handleDeleteReturnConfirm = async () => {
    if (!deletingReturn) return;
    try {
      setIsDeleting(true);
      await api.transactions.delete(deletingReturn.id);
      toast.success('বিক্রয় রিটার্ন চালানটি মুছে ফেলা হয়েছে!');
      setIsDeleteDialogOpen(false);
      setDeletingReturn(null);
      if (selectedReturn?.id === deletingReturn.id) {
        setSelectedReturn(null);
      }
      await loadReturnsData();
    } catch (err: any) {
      console.error(err);
      toast.error('রিটার্ন মুছে ফেলতে সমস্যা হয়েছে: ' + (err.message || err));
    } finally {
      setIsDeleting(false);
    }
  };

  const handleApproveReturn = async (r: ReturnEntry) => {
    try {
      await api.transactions.approve(r.id);
      toast.success(`বিক্রয় রিটার্ন চালানটি (${r.invoiceNo || r.id}) সফলভাবে অনুমোদন করা হয়েছে! স্টক ও কাস্টমার একাউন্টে সমন্বয় হয়েছে।`);
      loadReturnsData();
      if (selectedReturn && selectedReturn.id === r.id) {
        setSelectedReturn({ ...selectedReturn, status: 'approved' });
      }
    } catch (err: any) {
      toast.error(err.message || 'অনুমোদন করতে সমস্যা হয়েছে');
    }
  };

  const handleDirectPrintReturn = (r: ReturnEntry) => {
    setPrintingReturn(r);
    setTimeout(() => {
      printElement('printable-memo-wrapper');
    }, 100);
  };

  const loadReturnsData = async () => {
    try {
      setLoading(true);
      const returnsList = await api.transactions.list({ transaction_type: 'sale_return' });
      const mappedReturns: ReturnEntry[] = returnsList.map(r => {
        let meta: any = {};
        let cleanReason = r.notes || 'পণ্য ফেরত';
        if (r.notes && r.notes.trim().startsWith('{')) {
          try {
            const idx = r.notes.indexOf('\n');
            const jsonStr = idx !== -1 ? r.notes.substring(0, idx) : r.notes;
            meta = JSON.parse(jsonStr);
            cleanReason = meta.reason || (idx !== -1 ? r.notes.substring(idx + 1) : '');
          } catch {
            meta = {};
          }
        }

        const totalRetVal = Number(r.total_amount || 0);
        const netRefund = meta.netRefundValue !== undefined 
          ? Number(meta.netRefundValue) 
          : (totalRetVal - Number(meta.customerPayableCharges || 0));

        let invoiceNo = meta.invoiceNo;
        if (!invoiceNo && r.notes) {
          const invMatch = r.notes.match(/\[মেমো:\s*([^\]]+)\]/);
          if (invMatch) invoiceNo = invMatch[1].trim();
        }
        if (!invoiceNo && r.items && r.items.length > 0) {
          for (const itm of r.items) {
            const m = itm.product_name?.match(/\(ইনভ:([^)]+)\)/);
            if (m) {
              invoiceNo = m[1].trim();
              break;
            }
          }
        }

        return {
          id: String(r.id),
          invoiceNo: invoiceNo,
          customerName: r.party_name || 'সাধারণ গ্রাহক',
          customerId: String(r.party || ''),
          totalReturnValue: totalRetVal,
          netRefundValue: netRefund,
          dueAdjusted: Number(r.due_amount || 0),
          cashRefundPaid: Number(r.paid_amount || 0),
          paymentMethod: r.payment_method || 'cash',
          bankAccountId: (r as any).bank_account ? String((r as any).bank_account) : '',
          status: r.status || 'pending',
          returnedItems: (r.items || []).map(i => ({
            id: String(i.product || i.id || ''),
            productId: i.product ? Number(i.product) : null,
            name: i.product_name,
            quantity: Number(i.quantity),
            price: Number(i.price),
            unit: i.unit || 'পিস'
          })),
          reason: cleanReason,
          createdAt: r.created_at,
          rodLaborRate: meta.rodLaborRate,
          rodLaborCost: meta.rodLaborCost,
          rodLoadingToCustomerLedger: meta.rodLoadingToCustomerLedger,
          rodUnloadingRate: meta.rodUnloadingRate,
          rodUnloadingCost: meta.rodUnloadingCost,
          rodUnloadingToCustomerLedger: meta.rodUnloadingToCustomerLedger,
          cementLaborRate: meta.cementLaborRate,
          cementLaborCost: meta.cementLaborCost,
          cementLoadingToCustomerLedger: meta.cementLoadingToCustomerLedger,
          cementUnloadingRate: meta.cementUnloadingRate,
          cementUnloadingCost: meta.cementUnloadingCost,
          cementUnloadingToCustomerLedger: meta.cementUnloadingToCustomerLedger,
          shippingCost: meta.shippingCost,
          shippingCostToCustomerLedger: meta.shippingCostToCustomerLedger,
          rodShippingRate: meta.rodShippingRate,
          cementShippingRate: meta.cementShippingRate,
          customerPayableCharges: meta.customerPayableCharges,
          shopPaidCharges: meta.shopPaidCharges
        };
      });

      setReturns(mappedReturns);

      const partyList = await api.parties.list({ party_type: 'customer' });
      setCustomers(partyList.map(p => ({
        id: String(p.id),
        name: p.name,
        phone: p.phone,
        address: p.address || '',
        totalDue: Number(p.total_due || 0)
      })));

      const prodList = await api.inventory.list();
      setProducts(prodList.map(p => ({
        id: String(p.id),
        name: formatProductName(p.name, p.category_name),
        sellPrice: Number(p.sell_price || 0),
        stock: Number(p.stock || 0),
        unit: p.unit || 'পিস'
      })));
    } catch (err) {
      console.error('Error loading returns data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    (async () => {
      await loadReturnsData();
    })();
    return () => { ignore = true; };
  }, []);

  const formatDate = (at: any) => {
    if (!at) return '';
    try {
      const date = at?.toDate ? at.toDate() : new Date(at);
      if (isNaN(date.getTime())) return '';
      return toBengaliDigits(format(date, 'dd MMMM yyyy, hh:mm a', { locale: bn }));
    } catch {
      return '';
    }
  };

  // Add Item from Previous Invoice
  const handleAddFromInvoiceItem = (invItem: any, invNo?: string) => {
    const itemName = invItem.product_name || invItem.name;
    if (!itemName) return;

    const rawProdId = (invItem.product && typeof invItem.product === 'object')
      ? invItem.product.id
      : invItem.product;

    let validProdId: number | null = null;
    if (rawProdId && !isNaN(Number(rawProdId)) && products.some(p => Number(p.id) === Number(rawProdId))) {
      validProdId = Number(rawProdId);
    } else {
      const cleanName = cleanProdName(itemName);
      const matched = products.find(p => cleanProdName(p.name) === cleanName);
      if (matched) {
        validProdId = Number(matched.id);
      }
    }

    const existingIdx = returnCart.findIndex(i => i.name === itemName && i.condition === itemCondition);
    if (existingIdx > -1) {
      const updated = [...returnCart];
      updated[existingIdx].quantity += 1;
      setReturnCart(updated);
    } else {
      setReturnCart([...returnCart, {
        id: `ret-item-${returnCart.length + 1}-${Date.now()}`,
        productId: validProdId,
        name: itemName,
        quantity: 1,
        price: Number(invItem.price || 0),
        unit: invItem.unit || 'পিস',
        condition: itemCondition,
        invoiceNo: invNo || ''
      }]);
    }
    toast.success(`"${itemName}" ফেরত তালিকায় যুক্ত হয়েছে`);
  };

  // Safe rounding helper to prevent float precision digit overflow
  const round2 = (num: any) => Math.round((Number(num) || 0) * 100) / 100;

  // Category-specific quantity calculations (Rod/Ring in KG, Cement in Bags)
  const rodRingTotalKg = useMemo(() => {
    return round2(returnCart.reduce((sum, item) => {
      const isRod = (item.unit || '').includes('কেজি') || 
        (item.unit || '').toLowerCase().includes('kg') || 
        (item.unit || '').includes('টন') || 
        (item.unit || '').toLowerCase().includes('ton') || 
        (item.name || '').includes('রড') || 
        (item.name || '').includes('মিলি') || 
        (item.name || '').includes('মি.লি') || 
        (item.name || '').includes('মি.মি') || 
        (item.name || '').includes('মিমি');
      const isRing = (item.name || '').includes('রিং') || 
        (item.name || '').toLowerCase().includes('ring');
      if (isRod || isRing) {
        const isTon = (item.unit || '').toLowerCase().includes('ton') || (item.unit || '').includes('টন');
        return sum + (Number(item.quantity) || 0) * (isTon ? 1000 : 1);
      }
      return sum;
    }, 0));
  }, [returnCart]);

  const cementTotalBags = useMemo(() => {
    return round2(returnCart.reduce((sum, item) => {
      const isCement = (item.unit || '').includes('বস্তা') || 
        (item.unit || '').includes('ব্যাগ') || 
        (item.unit || '').toLowerCase().includes('bag') || 
        (item.name || '').includes('সিমেন্ট') || 
        (item.name || '').toLowerCase().includes('cement');
      if (isCement) {
        return sum + (Number(item.quantity) || 0);
      }
      return sum;
    }, 0));
  }, [returnCart]);

  const rodLaborRate = parseInputNumber(rodLaborRateInput);
  const rodUnloadingRate = parseInputNumber(rodUnloadingRateInput);
  const cementLaborRate = parseInputNumber(cementLaborRateInput);
  const cementUnloadingRate = parseInputNumber(cementUnloadingRateInput);
  const rodShippingRate = parseInputNumber(rodShippingRateInput);
  const cementShippingRate = parseInputNumber(cementShippingRateInput);
  const shippingCost = parseInputNumber(shippingCostInput);

  // Reactive automatic rate * quantity calculations
  const rodLaborAuto = round2(rodRingTotalKg * (rodLaborRate || 0));
  const rodLaborTotal = chargeCalcMode === 'rate'
    ? (rodRingTotalKg > 0
        ? (rodLaborTotalInput !== '' ? parseInputNumber(rodLaborTotalInput) : rodLaborAuto)
        : 0)
    : 0;
  
  const rodUnloadingAuto = round2(rodRingTotalKg * (rodUnloadingRate || 0));
  const rodUnloadingTotal = chargeCalcMode === 'rate'
    ? (rodRingTotalKg > 0
        ? (rodUnloadingTotalInput !== '' ? parseInputNumber(rodUnloadingTotalInput) : rodUnloadingAuto)
        : 0)
    : 0;

  const cementLaborAuto = round2(cementTotalBags * (cementLaborRate || 0));
  const cementLaborTotal = chargeCalcMode === 'rate'
    ? (cementTotalBags > 0
        ? (cementLaborTotalInput !== '' ? parseInputNumber(cementLaborTotalInput) : cementLaborAuto)
        : 0)
    : 0;

  const cementUnloadingAuto = round2(cementTotalBags * (cementUnloadingRate || 0));
  const cementUnloadingTotal = chargeCalcMode === 'rate'
    ? (cementTotalBags > 0
        ? (cementUnloadingTotalInput !== '' ? parseInputNumber(cementUnloadingTotalInput) : cementUnloadingAuto)
        : 0)
    : 0;

  const handleRodLaborRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setRodLaborRateInput(formatted);
    setRodLaborTotalInput('');
  };

  const handleRodUnloadingRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setRodUnloadingRateInput(formatted);
    setRodUnloadingTotalInput('');
  };

  const handleCementLaborRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setCementLaborRateInput(formatted);
    setCementLaborTotalInput('');
  };

  const handleCementUnloadingRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setCementUnloadingRateInput(formatted);
    setCementUnloadingTotalInput('');
  };

  const handleRodShippingRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setRodShippingRateInput(formatted);
    const rRate = parseInputNumber(formatted);
    const cRate = parseInputNumber(cementShippingRateInput);
    const total = round2((rodRingTotalKg * rRate) + (cementTotalBags * cRate));
    if (total > 0) {
      setShippingCostInput(formatDecimalInput(String(total)));
    }
  };

  const handleCementShippingRateChange = (val: string) => {
    const formatted = formatDecimalInput(val);
    setCementShippingRateInput(formatted);
    const cRate = parseInputNumber(formatted);
    const rRate = parseInputNumber(rodShippingRateInput);
    const total = round2((rodRingTotalKg * rRate) + (cementTotalBags * cRate));
    if (total > 0) {
      setShippingCostInput(formatDecimalInput(String(total)));
    }
  };

  const handleSaveDefaultCharges = () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('dokan_sales_rod_labor_rate', (rodLaborRate || 0).toString());
      localStorage.setItem('dokan_sales_rod_loading_to_customer', rodLoadingToCustomerLedger.toString());
      localStorage.setItem('dokan_sales_rod_unloading_rate', (rodUnloadingRate || 0).toString());
      localStorage.setItem('dokan_sales_rod_unloading_to_customer', rodUnloadingToCustomerLedger.toString());
      localStorage.setItem('dokan_sales_cement_labor_rate', (cementLaborRate || 0).toString());
      localStorage.setItem('dokan_sales_cement_loading_to_customer', cementLoadingToCustomerLedger.toString());
      localStorage.setItem('dokan_sales_cement_unloading_rate', (cementUnloadingRate || 0).toString());
      localStorage.setItem('dokan_sales_cement_unloading_to_customer', cementUnloadingToCustomerLedger.toString());
      localStorage.setItem('dokan_sales_shipping_to_customer', shippingCostToCustomerLedger.toString());
      localStorage.setItem('dokan_sales_rod_shipping_rate', (rodShippingRate || 0).toString());
      localStorage.setItem('dokan_sales_cement_shipping_rate', (cementShippingRate || 0).toString());
      localStorage.setItem('dokan_sales_shipping_cost', (shippingCost || 0).toString());
      toast.success('ডিফল্ট রেট সেভ করা হয়েছে');
    }
  };

  // Extra charges added to customer ledger vs shop drawer
  const customerPayableCharges = round2(
    (rodLoadingToCustomerLedger ? rodLaborTotal : 0) +
    (rodUnloadingToCustomerLedger ? rodUnloadingTotal : 0) +
    (cementLoadingToCustomerLedger ? cementLaborTotal : 0) +
    (cementUnloadingToCustomerLedger ? cementUnloadingTotal : 0) +
    (shippingCostToCustomerLedger ? shippingCost : 0)
  );

  const shopPaidCharges = round2(
    (!rodLoadingToCustomerLedger ? rodLaborTotal : 0) +
    (!rodUnloadingToCustomerLedger ? rodUnloadingTotal : 0) +
    (!cementLoadingToCustomerLedger ? cementLaborTotal : 0) +
    (!cementUnloadingToCustomerLedger ? cementUnloadingTotal : 0) +
    (!shippingCostToCustomerLedger ? shippingCost : 0)
  );

  // Financial Calculations
  const totalReturnedValue = round2(returnCart.reduce((sum, item) => sum + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0));
  const netRefundValue = round2(Math.max(0, totalReturnedValue - customerPayableCharges));

  const selectedCust = customers.find(c => c.id === selectedCustomerId);
  const currentDue = round2(selectedCust?.totalDue || 0);

  // Settlement calculations based on settlementMode and cash refund inputs
  let dueAdjusted = 0;
  let cashRefundPaid = 0;

  if (netRefundValue > 0) {
    if (settlementMode === 'cash') {
      cashRefundPaid = netRefundValue;
      dueAdjusted = 0;
    } else if (settlementMode === 'due_adjust') {
      dueAdjusted = round2(Math.min(currentDue, netRefundValue));
      cashRefundPaid = round2(Math.max(0, netRefundValue - dueAdjusted));
    } else {
      // custom mode
      cashRefundPaid = Math.min(netRefundValue, Math.max(0, round2(cashRefundPaidInput)));
      dueAdjusted = round2(Math.min(currentDue, Math.max(0, netRefundValue - cashRefundPaid)));
    }
  }

  const customerAdvanceCreated = (netRefundValue > 0 && (dueAdjusted + cashRefundPaid) < netRefundValue)
    ? round2(netRefundValue - dueAdjusted - cashRefundPaid)
    : 0;

  const newCustomerDue = netRefundValue > 0 
    ? round2(Math.max(0, currentDue - dueAdjusted))
    : round2(currentDue + Math.abs(netRefundValue));

  // Active selected invoice object
  const activeInvoice = customerInvoices.find(inv => String(inv.id) === selectedInvoiceId);

  // Submit Returns Form
  const handleSubmitReturnForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (returnCart.length === 0) {
      toast.error('অন্তত একটি ফেরত পণ্য যুক্ত করুন');
      return;
    }

    try {
      const metaObj = {
        reason: reason || 'পণ্য ফেরত ও বকেয়া এডজাস্ট',
        invoiceNo: activeInvoice ? activeInvoice.invoice_no : undefined,
        chargeCalcMode,
        rodRingTotalKg,
        cementTotalBags,
        rodLaborRate,
        rodLaborCost: rodLaborTotal,
        rodLoadingToCustomerLedger,
        rodUnloadingRate,
        rodUnloadingCost: rodUnloadingTotal,
        rodUnloadingToCustomerLedger,
        cementLaborRate,
        cementLaborCost: cementLaborTotal,
        cementLoadingToCustomerLedger,
        cementUnloadingRate,
        cementUnloadingCost: cementUnloadingTotal,
        cementUnloadingToCustomerLedger,
        shippingCost,
        shippingCostToCustomerLedger,
        rodShippingRate,
        cementShippingRate,
        customerPayableCharges,
        shopPaidCharges,
        totalReturnedValue,
        netRefundValue,
        cashRefundPaid: round2(cashRefundPaid),
        dueAdjusted: round2(dueAdjusted),
        settlementMode: settlementMode,
        paymentMethod: cashRefundPaid > 0 ? paymentMethod : 'cash',
        bankAccountId: (cashRefundPaid > 0 && (paymentMethod === 'bank' || paymentMethod === 'mobile_banking') && bankAccountId) ? bankAccountId : undefined,
      };

      const retInvoiceNo = editingReturn ? undefined : `RET-${String(returns.length + 1).padStart(6, '0')}`;
      const payload: any = {
        invoice_no: retInvoiceNo,
        party: Number(selectedCustomerId),
        party_name: selectedCust?.name || 'সাধারণ গ্রাহক',
        party_phone: selectedCust?.phone || '',
        transaction_type: 'sale_return',
        status: canApproveInvoice ? 'approved' : 'pending',
        total_amount: round2(totalReturnedValue),
        paid_amount: round2(cashRefundPaid),
        due_amount: round2(dueAdjusted),
        payment_method: cashRefundPaid > 0 ? paymentMethod : 'cash',
        bank_account: (cashRefundPaid > 0 && (paymentMethod === 'bank' || paymentMethod === 'mobile_banking') && bankAccountId) ? Number(bankAccountId) : null,
        items: returnCart.map(item => {
          let resolvedProductId: number | null = null;
          if (item.productId && typeof item.productId === 'number' && item.productId > 0 && products.some(p => Number(p.id) === item.productId)) {
            resolvedProductId = item.productId;
          } else {
            const numId = Number(item.id);
            if (!isNaN(numId) && numId > 0 && products.some(p => Number(p.id) === numId)) {
              resolvedProductId = numId;
            }
          }
          if (!resolvedProductId && item.name) {
            const cleanName = cleanProdName(item.name);
            const matched = products.find(p => cleanProdName(p.name) === cleanName);
            if (matched) {
              resolvedProductId = Number(matched.id);
            }
          }

          const q = round2(item.quantity);
          const p = round2(item.price);
          return {
            product: resolvedProductId,
            product_name: `${item.name}${item.condition === 'damaged' ? ' [ড্যামেজ]' : ''}${item.invoiceNo ? ` (ইনভ:${item.invoiceNo})` : ''}`,
            quantity: q,
            price: p,
            unit: item.unit || 'পিস',
            total: round2(p * q)
          };
        }),
        notes: `${JSON.stringify(metaObj)}\n${reason || 'পণ্য ফেরত ও বকেয়া এডজাস্ট'}${activeInvoice ? ` [মেমো: ${activeInvoice.invoice_no}]` : ''}`
      };

      if (editingReturn) {
        await api.transactions.update(editingReturn.id, payload);
        toast.success('বিক্রয় রিটার্ন চালানটি আপডেট করা হয়েছে!');
      } else {
        await api.transactions.create(payload);
        toast.success(canApproveInvoice
          ? 'বিক্রয় রিটার্ন সফলভাবে সংরক্ষিত ও অনুমোদিত হয়েছে! হিসাব, স্টক ও ড্রয়ারে যুক্ত হয়েছে।'
          : 'বিক্রয় রিটার্ন অপেক্ষমান (Pending) হিসেবে সংরক্ষিত হয়েছে! অনুমোদন করার পর স্টক ও হিসাবে যুক্ত হবে।');
      }

      setIsOpen(false);
      setEditingReturn(null);
      setSelectedCustomerId('');
      setReturnCart([]);
      resetChargeInputs();
      setReason('');
      setCashRefundPaidInput(0);
      setSettlementMode('due_adjust');
      setPaymentMethod('cash');
      setBankAccountId('');
      loadReturnsData();
    } catch (err: any) {
      console.error(err);
      toast.error('রিটার্ন সম্পন্ন করতে সমস্যা হয়েছে: ' + (err.message || err));
    }
  };

  const filteredReturns = returns.filter(r => {
    const searchLower = search.toLowerCase();
    const matchesSearch = !search ||
      r.customerName.toLowerCase().includes(searchLower) ||
      r.returnedItems.some(i => i.name.toLowerCase().includes(searchLower)) ||
      r.id.toLowerCase().includes(searchLower);

    let matchesDate = true;
    if (startDate || endDate) {
      const d = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt);
      if (!isNaN(d.getTime())) {
        const itemDateStr = format(d, 'yyyy-MM-dd');
        if (startDate && itemDateStr < startDate) matchesDate = false;
        if (endDate && itemDateStr > endDate) matchesDate = false;
      }
    }

    let matchesType = true;
    if (filterType === 'ক্যাশ ফেরত') {
      matchesType = (r.cashRefundPaid || 0) > 0;
    } else if (filterType === 'বকেয়া কাটা') {
      matchesType = (r.dueAdjusted || 0) > 0;
    }

    let matchesApproval = true;
    if (filterApprovalStatus !== 'all') {
      const isPending = r.status === 'pending' || r.status === 'draft' || r.status === 'অপেক্ষমান';
      if (filterApprovalStatus === 'approved' && isPending) matchesApproval = false;
      if (filterApprovalStatus === 'pending' && !isPending) matchesApproval = false;
    }

    let matchesAmount = true;
    const val = r.netRefundValue || r.totalReturnValue || 0;
    if (minRefund && val < parseFloat(minRefund)) matchesAmount = false;
    if (maxRefund && val > parseFloat(maxRefund)) matchesAmount = false;

    return Boolean(matchesSearch) && matchesDate && matchesType && matchesApproval && matchesAmount;
  });

  const totalPages = Math.max(1, Math.ceil(filteredReturns.length / pageSize));
  const validCurrentPage = Math.min(currentPage, totalPages);
  const startIndex = (validCurrentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filteredReturns.length);
  const paginatedReturns = filteredReturns.slice(startIndex, endIndex);

  const totalRefundAmountSum = returns.reduce((sum, r) => sum + (r.netRefundValue || r.totalReturnValue || 0), 0);

  return (
    <Shell>
      {selectedReturn ? (
        <div className="space-y-4 animate-in fade-in duration-300">
          <SalesReturnDetailsView
            returnEntry={selectedReturn}
            onBack={() => setSelectedReturn(null)}
            onPrint={() => printElement('printable-memo-wrapper')}
            onEdit={(r) => handleEditReturn(r)}
            onDelete={(r) => { setDeletingReturn(r); setIsDeleteDialogOpen(true); }}
            onApprove={canApproveInvoice ? (r) => handleApproveReturn(r) : undefined}
          />

          {/* Hidden Print Container */}
          {(printingReturn || selectedReturn) && (
            <div className="hidden print:block">
              <ReturnInvoiceMemo
                returnEntry={(printingReturn || selectedReturn) as any}
                showPrintButton={false}
              />
            </div>
          )}
        </div>
      ) : !isOpen ? (
        <div className="space-y-5 animate-in fade-in duration-300 font-bengali pb-10">
          {/* Always render Hidden Print Container if triggered from list table */}
          {printingReturn && !selectedReturn && (
            <div className="hidden print:block">
              <ReturnInvoiceMemo
                returnEntry={printingReturn as any}
                showPrintButton={false}
              />
            </div>
          )}
          
          {/* Top Title & Header Action */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                <RotateCcw className="w-7 h-7 text-blue-600" /> বিক্রয় ফেরত (Sales Return) ড্যাশবোর্ড
              </h2>
              <p className="text-slate-500 text-xs mt-0.5">পণ্য ফেরত, স্টক পুনঃসংযোজন ও কাস্টমার বকেয়া সামঞ্জস্যের হিসাব</p>
            </div>
            
            {canCreateInvoice && (
              <Button 
                onClick={() => {
                  setEditingReturn(null);
                  setSelectedCustomerId('');
                  setReturnCart([]);
                  resetChargeInputs();
                  setReason('');
                  setCashRefundPaidInput(0);
                  setSettlementMode('due_adjust');
                  setPaymentMethod('cash');
                  setBankAccountId('');
                  setIsOpen(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bengali h-10 px-5 rounded-md font-bold shadow-md shadow-blue-600/20 active:scale-95 transition-all text-xs cursor-pointer"
              >
                <Plus className="w-4 h-4 mr-1.5" />নতুন বিক্রয় রিটার্ন তৈরি করুন
              </Button>
            )}
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border border-slate-200/80 shadow-2xs rounded-md bg-white">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-md flex items-center justify-center bg-blue-50 text-blue-600 shrink-0">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">মোট সেলস রিটার্ন সংখ্যা</p>
                  <p className="text-xl font-black mt-0.5 text-slate-900">{returns.length} টি</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border border-slate-200/80 shadow-2xs rounded-md bg-white">
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-11 h-11 rounded-md flex items-center justify-center bg-rose-50 text-rose-600 shrink-0">
                  <DollarSign className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest font-black text-slate-500">মোট ফেরত মূল্য (রিফান্ড / বকেয়া এডজাস্ট)</p>
                  <p className="text-xl font-black mt-0.5 text-rose-600">৳ {totalRefundAmountSum.toLocaleString()}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* FILTER CARD */}
          <Card className="border border-slate-200/80 shadow-2xs rounded-md bg-white p-4 font-bengali space-y-3">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              
              {/* Unified Search Box */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="কাস্টমার নাম, ফোন বা ফেরতকৃত পণ্যের নাম দিয়ে খুঁজুন..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-10 h-10 rounded-md bg-slate-50/80 border-slate-200 text-xs font-bold text-slate-900 focus:bg-white transition-all placeholder:text-slate-400"
                />
                {search && (
                  <button 
                    onClick={() => setSearch('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Bengali Date Range Filter */}
              <BengaliDateRangePicker
                startDate={startDate}
                endDate={endDate}
                onChange={(start, end) => {
                  setStartDate(start);
                  setEndDate(end);
                }}
                placeholder="তারিখ ফিল্টার"
                compact={false}
              />

              {/* Approval Status Filter Dropdown */}
              <div className="w-full sm:w-[155px] shrink-0">
                <Select value={filterApprovalStatus} onValueChange={(val) => setFilterApprovalStatus(val || 'all')}>
                  <SelectTrigger className="rounded-md h-10 bg-slate-50/80 border-slate-200 text-xs font-bold text-slate-700">
                    <SelectValue placeholder="সব অনুমোদন" />
                  </SelectTrigger>
                  <SelectContent className="font-bengali text-xs font-bold">
                    <SelectItem value="all">সব অনুমোদন</SelectItem>
                    <SelectItem value="approved">🟢 অনুমোদিত</SelectItem>
                    <SelectItem value="pending">🟡 অপেক্ষমান</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
                {[
                  { id: 'সব', label: 'সব রিটার্ন' },
                  { id: 'ক্যাশ ফেরত', label: 'ক্যাশ ফেরত' },
                  { id: 'বকেয়া কাটা', label: 'বকেয়া কাটা' },
                ].map(p => (
                  <button
                    key={p.id}
                    onClick={() => setFilterType(p.id)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-md text-xs font-bold transition-all border whitespace-nowrap cursor-pointer",
                      filterType === p.id
                        ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* More Filters Toggle */}
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsFilterExpanded(!isFilterExpanded)}
                  className="h-10 px-3.5 rounded-md border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
                >
                  <Filter className="w-3.5 h-3.5 text-blue-600" />
                  <span>আরও ফিল্টার</span>
                  {isFilterExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </Button>

                {(search || startDate || endDate || filterType !== 'সব' || filterApprovalStatus !== 'all' || minRefund || maxRefund) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetFilters}
                    className="h-10 px-2.5 rounded-md text-rose-600 hover:bg-rose-50 font-bold text-xs flex items-center gap-1 cursor-pointer"
                    title="ফিল্টার রিসেট করুন"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Collapsible Range */}
            {isFilterExpanded && (
              <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in duration-200">
                <div className="space-y-1">
                  <Label className="text-[11px] font-bold text-slate-600">ফেরত মূল্য রেঞ্জ (৳)</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      placeholder="সর্বনিম্ন (৳)"
                      value={minRefund}
                      onChange={e => setMinRefund(e.target.value)}
                      className="rounded-md h-9 bg-slate-50/50 border-slate-200 text-xs font-bold"
                    />
                    <span className="text-slate-300 text-xs">-</span>
                    <Input
                      placeholder="সর্বোচ্চ (৳)"
                      value={maxRefund}
                      onChange={e => setMaxRefund(e.target.value)}
                      className="rounded-md h-9 bg-slate-50/50 border-slate-200 text-xs font-bold"
                    />
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* TABLE OF RETURNS */}
          <Card className="border border-slate-200/80 shadow-2xs rounded-md bg-white overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50/70 border-b border-slate-200">
                  <TableRow>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs">রিটার্ন তারিখ ও আইডি</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs">গ্রাহকের নাম</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs">ফেরত পণ্যসমূহ</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs">লেবার ও পরিবহন</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs text-right">মোট ফেরত মূল্য</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs text-right">হিসাব নিষ্পত্তি</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs text-center">স্ট্যাটাস</TableHead>
                    <TableHead className="font-bold text-slate-700 py-3.5 px-4 text-xs text-right w-32">অ্যাকশন</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-slate-500 text-xs font-bold">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-blue-600" />
                        রিটার্ন তালিকা লোড হচ্ছে...
                      </TableCell>
                    </TableRow>
                  ) : filteredReturns.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-xs font-bold">
                        কোনো বিক্রয় ফেরত রেকর্ড পাওয়া যায়নি।
                      </TableCell>
                    </TableRow>
                  ) : paginatedReturns.map((r) => (
                    <TableRow 
                      key={r.id} 
                      onClick={() => setSelectedReturn(r)}
                      className="hover:bg-blue-50/60 transition-colors border-b border-slate-100 cursor-pointer group"
                      title="রিটার্ন চালান বিবরণী দেখতে ক্লিক করুন"
                    >
                      <TableCell className="py-3 px-4">
                        <div className="font-bold text-slate-900 text-xs group-hover:text-blue-600 transition-colors">
                          {formatDate(r.createdAt)}
                        </div>
                        <span className="font-mono text-[10px] text-blue-600 font-bold bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          #{r.id.slice(0, 8).toUpperCase()}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <span className="font-bold text-slate-800 text-xs group-hover:text-blue-700 transition-colors">{r.customerName}</span>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="space-y-0.5">
                          {r.returnedItems.map((item, idx) => (
                            <div key={idx} className="text-xs font-bold text-rose-600">
                              • {item.name} ({item.quantity} {item.unit})
                            </div>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="space-y-0.5 text-xs">
                          {((r.rodLaborCost || 0) + (r.rodUnloadingCost || 0) + (r.cementLaborCost || 0) + (r.cementUnloadingCost || 0)) > 0 && (
                            <div className="font-bold text-slate-700">
                              লেবার: ৳ {toBengaliDigits(((r.rodLaborCost || 0) + (r.rodUnloadingCost || 0) + (r.cementLaborCost || 0) + (r.cementUnloadingCost || 0)).toLocaleString('en-IN'))}
                            </div>
                          )}
                          {(r.shippingCost || 0) > 0 && (
                            <div className="font-bold text-slate-700">
                              গাড়ি ভাড়া: ৳ {toBengaliDigits((r.shippingCost || 0).toLocaleString('en-IN'))}
                            </div>
                          )}
                          {!(((r.rodLaborCost || 0) + (r.rodUnloadingCost || 0) + (r.cementLaborCost || 0) + (r.cementUnloadingCost || 0)) > 0) && !((r.shippingCost || 0) > 0) && (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-black text-rose-600 text-sm py-3 px-4">
                        ৳ {(r.totalReturnValue || r.netRefundValue || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right py-3 px-4">
                        <div className="text-xs">
                          {r.dueAdjusted > 0 && (
                            <span className="block font-bold text-blue-700">বকেয়া কাটা: ৳ {r.dueAdjusted.toLocaleString()}</span>
                          )}
                          {r.cashRefundPaid > 0 && (
                            <span className="block font-bold text-rose-600">
                              ক্যাশ ফেরত: ৳ {r.cashRefundPaid.toLocaleString()}
                              <span className="text-[10px] text-slate-500 font-normal ml-1">
                                ({r.paymentMethod === 'bank' ? 'ব্যাংক' : r.paymentMethod === 'mobile_banking' ? 'মোবাইল' : 'নগদ'})
                              </span>
                            </span>
                          )}
                          {r.dueAdjusted === 0 && r.cashRefundPaid === 0 && (
                            <span className="font-bold text-emerald-600">সমপরিমাণ অ্যাডজাস্ট</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4 text-center">
                        {r.status === 'pending' || r.status === 'draft' || r.status === 'অপেক্ষমান' ? (
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 inline-flex items-center gap-1">
                            🟡 অপেক্ষমান
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                            🟢 অনুমোদিত
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right py-3.5 px-6" onClick={(e) => e.stopPropagation()}>
                        <TableRowActionMenu
                          onView={() => setSelectedReturn(r)}
                          onPrint={() => handleDirectPrintReturn(r)}
                          onEdit={() => handleEditReturn(r)}
                          onDelete={() => { setDeletingReturn(r); setIsDeleteDialogOpen(true); }}
                          onApprove={canApproveInvoice ? () => handleApproveReturn(r) : undefined}
                          isPending={r.status === 'pending' || r.status === 'draft' || r.status === 'অপেক্ষমান'}
                          canEdit={canEditInvoice}
                          canDelete={canDeleteInvoice}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>

            {/* PAGINATION FOOTER NAVBAR */}
            {filteredReturns.length > 0 && (
              <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-4 font-bengali text-xs font-semibold">
                <div className="text-slate-600 flex items-center gap-2">
                  <span>
                    মোট <strong className="text-slate-900 font-bold">{toBengaliDigits(filteredReturns.length)}</strong> টি ইনভয়েসের মধ্যে <strong className="text-slate-900 font-bold">{toBengaliDigits(startIndex + 1)}</strong> - <strong className="text-slate-900 font-bold">{toBengaliDigits(endIndex)}</strong> টি দেখানো হচ্ছে
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 text-slate-500">
                    <span>প্রতি পেজে:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="h-8 rounded-md bg-white border border-slate-200 px-2 font-bold text-xs text-slate-800 outline-none cursor-pointer"
                    >
                      <option value={10}>১০ টি</option>
                      <option value={20}>২০ টি</option>
                      <option value={50}>৫০ টি</option>
                      <option value={100}>১০০ টি</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={validCurrentPage <= 1}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      className="h-8 px-2.5 rounded-md text-xs font-bold bg-white text-slate-700 border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                    >
                      <ChevronLeft className="w-4 h-4 mr-0.5" /> আগের পেজ
                    </Button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                        .map((page, idx, arr) => {
                          const prev = arr[idx - 1];
                          const showEllipsis = prev && page - prev > 1;
                          return (
                            <div key={page} className="flex items-center gap-1">
                              {showEllipsis && <span className="px-1 text-slate-400">...</span>}
                              <button
                                onClick={() => setCurrentPage(page)}
                                className={cn(
                                  "w-8 h-8 rounded-md text-xs font-bold transition-all border",
                                  currentPage === page
                                    ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                                )}
                              >
                                {toBengaliDigits(page)}
                              </button>
                            </div>
                          );
                        })}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={validCurrentPage >= totalPages}
                      onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                      className="h-8 px-2.5 rounded-md text-xs font-bold bg-white text-slate-700 border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                    >
                      পরের পেজ <ChevronRight className="w-4 h-4 ml-0.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </Card>
        </div>

      ) : (
        /* CREATE / EDIT SALES RETURN VIEW */
        <div className="space-y-4 animate-in fade-in duration-300 font-bengali">
          <div className="w-full bg-slate-100 border-2 border-slate-300 shadow-xl rounded-md overflow-hidden flex flex-col min-h-[calc(100vh-100px)]">
            
            {/* FRAME TOP HEADER BAR */}
            <div className="bg-white border-b border-slate-300 px-6 py-3.5 flex items-center justify-between shadow-xs flex-shrink-0">
              <div className="flex items-center gap-3">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={() => setIsOpen(false)}
                  className="w-9 h-9 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-700 font-bold shadow-xs flex-shrink-0 transition-colors cursor-pointer"
                  title="তালিকায় ফিরে যান"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div>
                  <span className="text-[10px] font-black tracking-widest text-blue-600 uppercase block">
                    SALES RETURN & RESTOCK (বিক্রয় ফেরত)
                  </span>
                  <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">
                    {editingReturn ? 'বিক্রয় রিটার্ন এডিট করুন' : 'নতুন বিক্রয় রিটার্ন ও বকেয়া এডজাস্টমেন্ট'}
                  </h1>
                </div>
              </div>

              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setIsOpen(false)}
                className="h-9 w-9 rounded-md hover:bg-rose-50 hover:text-rose-600 text-slate-500 transition-colors cursor-pointer"
                title="বন্ধ করুন"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* MAIN FORM CONTENT */}
            <form onSubmit={handleSubmitReturnForm} className="p-4 md:p-6 w-full space-y-6 flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* LEFT 8 COLUMNS: FORM STEPS */}
                <div className="lg:col-span-8 space-y-5">
                  
                  {/* STEP 1: Select Customer */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                        <Label className="text-xs uppercase tracking-wider font-black text-slate-900 flex items-center gap-2">
                          <User className="w-4 h-4 text-blue-600" /> ১. কাস্টমার নির্বাচন করুন (Customer)
                        </Label>
                        {selectedCust && (
                          <span className="text-xs font-bold bg-amber-50 text-amber-700 px-3 py-1 rounded-md border border-amber-200">
                            বর্তমান মোট বকেয়া: ৳ {(selectedCust.totalDue || 0).toLocaleString()}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-slate-600">কাস্টমার নির্বাচন করুন <span className="text-rose-500">*</span></Label>
                          <CustomerSearchSelect
                            customers={customers}
                            selectedCustomer={customers.find(c => c.id === selectedCustomerId) || null}
                            onSelectCustomer={(cust) => setSelectedCustomerId(cust ? cust.id : '')}
                            placeholder="কাস্টমার নির্বাচন করতে খুঁজুন..."
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs font-bold text-slate-600">রিটার্ন তারিখ</Label>
                          <Input
                            disabled
                            value={format(new Date(), 'dd MMMM yyyy, hh:mm a', { locale: bn })}
                            className="rounded-md h-10 bg-slate-100 border-slate-200 text-xs font-bold text-slate-600 cursor-not-allowed"
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* STEP 2: Returned Products from Sales Invoice */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <Label className="text-xs uppercase tracking-wider font-black text-rose-700 flex items-center gap-2">
                          <RotateCcw className="w-4 h-4 text-rose-600" /> ২. বিক্রয় চালান থেকে ফেরতকৃত পণ্য (Returned Products)
                        </Label>

                        {/* CONDITION PICKER */}
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-bold text-slate-700">ডিফল্ট কন্ডিশন:</span>
                          <button
                            type="button"
                            onClick={() => setItemCondition('good')}
                            className={cn(
                              "px-2.5 py-1 rounded-md font-bold text-xs border transition-all flex items-center gap-1 cursor-pointer",
                              itemCondition === 'good'
                                ? "bg-emerald-600 text-white border-emerald-600 shadow-2xs"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>🟢 ভালো (স্টকে ইন)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setItemCondition('damaged')}
                            className={cn(
                              "px-2.5 py-1 rounded-md font-bold text-xs border transition-all flex items-center gap-1 cursor-pointer",
                              itemCondition === 'damaged'
                                ? "bg-rose-600 text-white border-rose-600 shadow-2xs"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            <span>🔴 ড্যামেজ (নষ্ট)</span>
                          </button>
                        </div>
                      </div>

                      {/* INVOICE-LINKED RETURN VIEW */}
                      <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                        {!selectedCustomerId ? (
                          <div className="text-center py-8 text-slate-500 text-xs font-bold space-y-1">
                            <AlertCircle className="w-6 h-6 text-amber-500 mx-auto mb-1" />
                            <p className="text-slate-800">পণ্য ফেরত নিতে প্রথমে উপরে কাস্টমার নির্বাচন করুন।</p>
                            <p className="text-[11px] text-slate-400 font-normal">কাস্টমার সিলেক্ট করলেই তার বিক্রয় মেমোগুলো এবং পণ্য এখানে চলে আসবে।</p>
                          </div>
                        ) : loadingInvoices ? (
                          <div className="text-center py-8 text-slate-500 text-xs font-bold flex items-center justify-center gap-2">
                            <RefreshCw className="w-5 h-5 animate-spin text-blue-600" />
                            কাস্টমারের পূর্বের মেমোগুলো লোড হচ্ছে...
                          </div>
                        ) : customerInvoices.length === 0 ? (
                          <div className="text-center py-6 space-y-2">
                            <AlertCircle className="w-6 h-6 text-amber-500 mx-auto mb-1" />
                            <p className="text-xs text-slate-700 font-bold">এই কাস্টমারের কোনো পূর্বের বিক্রয় চালান পাওয়া যায়নি।</p>
                            <p className="text-[11px] text-slate-400">রিটার্ন করতে হলে কাস্টমারের ন্যূনতম একটি বিক্রয় মেমো থাকতে হবে।</p>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {/* Invoice Selector */}
                            <div className="space-y-1.5">
                              <Label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                                <span>বিক্রয় মেমো নির্বাচন করুন (মেমো সিলেক্ট করলেই সব আইটেম নিচে চলে আসবে):</span>
                                {activeInvoice && (
                                  <span className="text-blue-600 font-bold text-[11px]">
                                    মোট {toBengaliDigits(activeInvoice.items?.length || 0)}টি আইটেম
                                  </span>
                                )}
                              </Label>
                              <Select 
                                value={selectedInvoiceId} 
                                onValueChange={(val: string | null) => {
                                  const nextId = val || '';
                                  setSelectedInvoiceId(nextId);
                                  const found = customerInvoices.find(inv => String(inv.id) === nextId);
                                  if (found) {
                                    loadInvoiceItemsIntoReturnCart(found);
                                  }
                                }}
                              >
                                <SelectTrigger className="h-11 bg-white border-slate-300 font-bold text-xs rounded-lg shadow-2xs">
                                  <SelectValue placeholder="মেমো নির্বাচন করুন..." />
                                </SelectTrigger>
                                <SelectContent className="font-bengali text-xs max-h-64">
                                  {customerInvoices.map((inv) => {
                                    const status = getInvoiceReturnableStatus(inv);
                                    return (
                                      <SelectItem key={inv.id} value={String(inv.id)} className="py-2">
                                        <div className="flex items-center gap-2">
                                          <span className="font-black text-blue-700">#{inv.invoice_no || inv.id}</span>
                                          <span className="text-slate-400">|</span>
                                          <span className="text-slate-600">{formatDate(inv.created_at)}</span>
                                          <span className="text-slate-400">|</span>
                                          <span className="font-bold text-emerald-700">৳{(inv.total_amount || 0).toLocaleString()}</span>
                                          <span className="text-slate-400">|</span>
                                          {status.isFullyReturned ? (
                                            <span className="text-rose-600 font-bold text-[10px] bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                                              সম্পূর্ণ ফেরত সম্পন্ন
                                            </span>
                                          ) : (
                                            <span className="text-emerald-700 font-bold text-[10px] bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                              ফেরতযোগ্য: {toBengaliDigits(status.returnableCount)}টি
                                            </span>
                                          )}
                                        </div>
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Active Invoice Info Card & Quick Action Buttons */}
                            {activeInvoice && (
                              <div className="p-3.5 bg-white border border-blue-200/80 rounded-xl shadow-2xs space-y-2.5">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                  <div className="flex items-center gap-2.5">
                                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
                                      <Receipt className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="font-black text-slate-900 text-xs">মেমো #{activeInvoice.invoice_no || activeInvoice.id}</span>
                                        <span className="text-[11px] text-slate-500 font-medium">({formatDate(activeInvoice.created_at)})</span>
                                      </div>
                                      <div className="text-[11px] text-slate-600 font-bold mt-0.5">
                                        মোট বিক্রয়: <span className="text-emerald-700">৳{(activeInvoice.total_amount || 0).toLocaleString()}</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => loadInvoiceItemsIntoReturnCart(activeInvoice)}
                                      className="text-xs font-bold text-blue-700 border-blue-200 bg-blue-50/50 hover:bg-blue-100 rounded-lg h-8 px-3 cursor-pointer"
                                    >
                                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                                      চালানের পণ্য আবার আনুন
                                    </Button>
                                    {returnCart.length > 0 && (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setReturnCart([])}
                                        className="text-xs font-bold text-rose-600 hover:bg-rose-50 rounded-lg h-8 px-2.5 cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                                        তালিকা খালি করুন
                                      </Button>
                                    )}
                                  </div>
                                </div>

                                {getInvoiceReturnableStatus(activeInvoice).isFullyReturned && (
                                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-bold flex items-center gap-2">
                                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                                    <span>এই মেমোর সকল পণ্য ইতিপূর্বে সম্পূর্ণ ফেরত নেওয়া সম্পন্ন হয়েছে। নতুন কোনো পণ্য আর ফেরত নেওয়া যাবে না।</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Return Table & Inline Item Editor */}
                      <div className="border border-slate-200 rounded-xl overflow-hidden mt-4 bg-white shadow-2xs">
                        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 text-xs flex items-center gap-1.5">
                              <RotateCcw className="w-4 h-4 text-rose-600" />
                              ফেরত তালিকাভুক্ত পণ্যসমূহ ({toBengaliDigits(returnCart.length)}টি):
                            </span>
                          </div>
                          <span className="text-[11px] text-slate-500 font-bold">
                            (যে পণ্যটি ফেরত নিচ্ছে না, ডানে লাল 🗑️ বাটনে ক্লিক করে বাদ দিন)
                          </span>
                        </div>

                        <Table>
                          <TableHeader className="bg-slate-50/50 text-slate-700 text-xs">
                            <TableRow>
                              <TableHead className="font-bold w-10 text-center">#</TableHead>
                              <TableHead className="font-bold">ফেরত পণ্যের নাম</TableHead>
                              <TableHead className="font-bold w-32">কন্ডিশন</TableHead>
                              <TableHead className="font-bold w-48 text-center">ফেরত পরিমাণ</TableHead>
                              <TableHead className="font-bold w-32 text-right">একক দর (৳)</TableHead>
                              <TableHead className="font-bold w-32 text-right">মোট মূল্য (৳)</TableHead>
                              <TableHead className="w-12 text-center">অ্যাকশন</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody className="text-xs font-bold">
                            {returnCart.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={7} className="text-center py-8 text-slate-400 font-normal">
                                  <div className="space-y-1">
                                    <Package className="w-6 h-6 mx-auto text-slate-300 mb-1" />
                                    <p className="font-bold text-slate-500">কোনো ফেরত পণ্য তালিকায় নেই।</p>
                                    <p className="text-[11px] text-slate-400">মেমো নির্বাচন করুন (ইতিপূর্বে সব ফেরত হয়ে থাকলে তালিকা খালি থাকবে)।</p>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ) : (
                              returnCart.map((item, idx) => (
                                <TableRow key={idx} className="hover:bg-slate-50/80 transition-colors border-b border-slate-100">
                                  <TableCell className="text-center font-semibold text-slate-500">{toBengaliDigits(idx + 1)}</TableCell>
                                  
                                  <TableCell className="py-2.5">
                                    <div className="font-black text-slate-900 text-xs">{item.name}</div>
                                    {item.invoiceNo && (
                                      <span className="inline-block mt-0.5 text-[10px] text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.2 rounded font-mono font-bold">
                                        মেমো: #{item.invoiceNo}
                                      </span>
                                    )}
                                  </TableCell>

                                  <TableCell className="py-2.5">
                                    <select
                                      value={item.condition || 'good'}
                                      onChange={(e) => {
                                        const updated = [...returnCart];
                                        updated[idx].condition = e.target.value as 'good' | 'damaged';
                                        setReturnCart(updated);
                                      }}
                                      className={cn(
                                        "h-8 px-2 rounded-md font-bold text-[11px] border cursor-pointer outline-none w-full",
                                        item.condition === 'damaged'
                                          ? "bg-rose-50 text-rose-700 border-rose-200 font-black"
                                          : "bg-emerald-50 text-emerald-700 border-emerald-200 font-black"
                                      )}
                                    >
                                      <option value="good">🟢 ভালো (স্টকে ইন)</option>
                                      <option value="damaged">🔴 ড্যামেজ (নষ্ট)</option>
                                    </select>
                                  </TableCell>

                                  <TableCell className="py-2.5 text-center">
                                    <div className="flex flex-col items-center justify-center gap-0.5">
                                      <div className="flex items-center justify-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (item.quantity > 1) {
                                              const updated = [...returnCart];
                                              updated[idx].quantity -= 1;
                                              setReturnCart(updated);
                                            }
                                          }}
                                          className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 font-black text-xs flex items-center justify-center cursor-pointer text-slate-700 shrink-0"
                                        >
                                          -
                                        </button>
                                        <Input
                                          type="number"
                                          step="any"
                                          min="0.01"
                                          max={item.maxQuantity}
                                          value={item.quantity}
                                          onChange={(e) => {
                                            const entered = parseFloat(e.target.value);
                                            const max = item.maxQuantity || Infinity;
                                            if (!isNaN(entered) && entered > max) {
                                              toast.warning(`⚠️ এই চালানে বিক্রিত পরিমাণ ${max} ${item.unit}, এর বেশি ফেরত নেওয়া সম্ভব নয়!`);
                                            }
                                            const val = Math.min(Math.max(0.01, isNaN(entered) ? 0.01 : entered), max);
                                            const updated = [...returnCart];
                                            updated[idx].quantity = Math.round(val * 100) / 100;
                                            setReturnCart(updated);
                                          }}
                                          className="w-16 h-7 text-center font-black text-xs rounded-md border-slate-300 p-0"
                                        />
                                        <button
                                          type="button"
                                          disabled={item.maxQuantity !== undefined && item.quantity >= item.maxQuantity}
                                          onClick={() => {
                                            const max = item.maxQuantity || Infinity;
                                            if (item.quantity < max) {
                                              const updated = [...returnCart];
                                              updated[idx].quantity += 1;
                                              setReturnCart(updated);
                                            } else {
                                              toast.warning(`⚠️ এই চালানে বিক্রিত পরিমাণ ${max} ${item.unit}, এর বেশি ফেরত নেওয়া সম্ভব নয়!`);
                                            }
                                          }}
                                          className={cn(
                                            "w-7 h-7 rounded-md font-black text-xs flex items-center justify-center shrink-0",
                                            item.maxQuantity !== undefined && item.quantity >= item.maxQuantity
                                              ? "bg-slate-100 text-slate-300 cursor-not-allowed"
                                              : "bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
                                          )}
                                        >
                                          +
                                        </button>
                                        <span className="text-[11px] text-slate-500 font-bold shrink-0 ml-1">{item.unit}</span>
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-bold text-center leading-tight">
                                        {item.soldQuantity !== undefined ? (
                                          <span>
                                            বিক্রি: {toBengaliDigits(item.soldQuantity)}
                                            {item.alreadyReturnedQty ? ` (পূর্বে ফেরত: ${toBengaliDigits(item.alreadyReturnedQty)})` : ''}
                                            {' | '}অবশিষ্ট: <strong className="text-blue-700 font-black">{toBengaliDigits(item.maxQuantity || item.quantity)} {item.unit}</strong>
                                          </span>
                                        ) : item.maxQuantity !== undefined ? (
                                          <span>সর্বোচ্চ: {toBengaliDigits(item.maxQuantity)} {item.unit}</span>
                                        ) : null}
                                      </div>
                                    </div>
                                  </TableCell>

                                  <TableCell className="py-2.5 text-right">
                                    <Input
                                      type="number"
                                      min="0"
                                      step="any"
                                      value={item.price}
                                      onChange={(e) => {
                                        const val = Math.max(0, Number(e.target.value) || 0);
                                        const updated = [...returnCart];
                                        updated[idx].price = val;
                                        setReturnCart(updated);
                                      }}
                                      className="w-20 h-7 text-right font-black text-xs rounded-md border-slate-300 ml-auto"
                                    />
                                  </TableCell>

                                  <TableCell className="py-2.5 text-right text-rose-600 font-black text-xs">
                                    ৳ {toBengaliDigits((item.quantity * item.price).toLocaleString('en-IN'))}
                                  </TableCell>

                                  <TableCell className="py-2.5 text-center">
                                    <Button 
                                      type="button" 
                                      size="icon"
                                      variant="ghost"
                                      title="এই পণ্যটি ফেরত তালিকা থেকে বাদ দিন"
                                      onClick={() => {
                                        const updated = returnCart.filter((_, i) => i !== idx);
                                        setReturnCart(updated);
                                        toast.info(`"${item.name}" ফেরত তালিকা থেকে বাদ দেওয়া হয়েছে`);
                                      }} 
                                      className="h-7 w-7 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md cursor-pointer"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </TableCell>
                                </TableRow>
                              ))
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>

                  {/* STEP 3: Shipping & Labor Charges */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs font-bengali">
                    <CardContent className="p-5 space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-3 gap-2">
                        <Label className="text-xs uppercase tracking-wider font-black text-slate-800 flex items-center gap-2">
                          <Truck className="w-4 h-4 text-emerald-600" /> ৩. পরিবহন ও লেবার খরচ (Shipping & Labor)
                        </Label>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={handleSaveDefaultCharges}
                            className="text-[10px] font-black text-amber-700 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-sm border border-amber-300 transition-colors cursor-pointer font-bengali"
                            title="বর্তমানে দেওয়া রেটগুলো সব সময় ডিফল্ট হিসেবে রাখতে এখানে ক্লিক করুন"
                          >
                            📌 ডিফল্ট রেট সেভ করুন
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between bg-slate-50 p-2.5 rounded-md border border-slate-200 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-600"></span>
                          <span className="font-bold text-slate-800">প্রতি ইউনিট রেট অনুযায়ী (রড কেজি ও সিমেন্ট বস্তা)</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-medium hidden sm:inline">
                          (সরাসরি মোট টাকা এডিটও করা যাবে)
                        </span>
                      </div>

                      <div className="space-y-3 font-bengali">
                        {/* Rod & Ring Rate Box */}
                        {(rodRingTotalKg > 0 || (rodRingTotalKg === 0 && cementTotalBags === 0)) && (
                          <div className="bg-sky-50/60 border border-sky-200 rounded-md p-3 space-y-3">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-black text-sky-900 flex items-center gap-1.5">
                                🔹 রড ও রিং লেবার খরচ
                              </span>
                              <span className="bg-sky-100 text-sky-800 font-bold px-2 py-0.5 rounded text-[11px]">
                                ফেরত রডের ওজন: {toBengaliDigits(rodRingTotalKg.toLocaleString('en-IN'))} কেজি
                              </span>
                            </div>

                            {/* Rod Loading Section */}
                            <div className={cn(
                              "space-y-1.5 p-2 rounded-md transition-all",
                              rodLoadingToCustomerLedger ? "bg-sky-50/80 border border-sky-200" : "bg-slate-50/80 border border-slate-200"
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-[11px] font-bold text-slate-700">লোডিং লেবার খরচ</Label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={rodLoadingToCustomerLedger}
                                    onClick={() => setRodLoadingToCustomerLedger(!rodLoadingToCustomerLedger)}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-sky-500",
                                      rodLoadingToCustomerLedger ? "bg-sky-600" : "bg-slate-300"
                                    )}
                                    title="কাস্টমারের লেজারে যুক্ত বা বাদ দিতে ক্লিক করুন"
                                  >
                                    <span
                                      className={cn(
                                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                                        rodLoadingToCustomerLedger ? "translate-x-4" : "translate-x-0"
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRodLoadingToCustomerLedger(!rodLoadingToCustomerLedger)}
                                    className={cn(
                                      "text-[9px] font-black px-1.5 py-0.5 rounded border select-none cursor-pointer transition-colors",
                                      rodLoadingToCustomerLedger 
                                        ? "bg-sky-100 text-sky-800 border-sky-300" 
                                        : "bg-slate-200 text-slate-600 border-slate-300"
                                    )}
                                  >
                                    {rodLoadingToCustomerLedger ? 'কাস্টমার লেজারে যুক্ত' : 'দোকান প্রদেয় / লেজারে বাদ'}
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-slate-500 font-medium">লোডিং রেট (৳/কেজি)</span>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={rodLaborRateInput}
                                    onChange={e => handleRodLaborRateChange(e.target.value)}
                                    placeholder="০.০০"
                                    className="rounded-md h-9 bg-white border-sky-300 text-xs font-bold text-slate-800 font-bengali"
                                  />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500 font-medium">মোট লোডিং (৳)</span>
                                    <span className="text-[9px] text-amber-700 font-bold">(রাউন্ড/এডিটযোগ্য)</span>
                                  </div>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={rodLaborTotalInput !== '' ? rodLaborTotalInput : (rodLaborTotal > 0 ? String(rodLaborTotal) : '')}
                                    onChange={e => setRodLaborTotalInput(formatDecimalInput(e.target.value))}
                                    placeholder={rodLaborTotal > 0 ? String(rodLaborTotal) : '০.০০'}
                                    className="rounded-md h-9 bg-white border-sky-300 text-xs font-bold text-amber-700 font-bengali"
                                  />
                                </div>
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium block",
                                rodLoadingToCustomerLedger ? "text-sky-800" : "text-amber-800"
                              )}>
                                {rodLoadingToCustomerLedger 
                                  ? '💡 রড লোডিং খরচ কাস্টমারের বিলে ও লেজারে যুক্ত হবে।' 
                                  : '💡 রড লোডিং খরচ কাস্টমারের বিলে বা লেজারে যুক্ত হবে না (দোকান বহন করবে / আলাদা হিসাব)।'}
                              </span>
                            </div>

                            {/* Rod Unloading Section */}
                            <div className={cn(
                              "pt-2 border-t border-sky-200/80 space-y-1.5 p-2 rounded-md transition-all",
                              rodUnloadingToCustomerLedger ? "bg-emerald-50/40 border border-emerald-200/60" : "bg-slate-50/80 border border-slate-200"
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-[11px] font-bold text-slate-700">আনলোডিং লেবার খরচ</Label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={rodUnloadingToCustomerLedger}
                                    onClick={() => setRodUnloadingToCustomerLedger(!rodUnloadingToCustomerLedger)}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-emerald-500",
                                      rodUnloadingToCustomerLedger ? "bg-emerald-600" : "bg-slate-300"
                                    )}
                                    title="কাস্টমারের লেজারে যুক্ত বা বাদ দিতে ক্লিক করুন"
                                  >
                                    <span
                                      className={cn(
                                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                                        rodUnloadingToCustomerLedger ? "translate-x-4" : "translate-x-0"
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRodUnloadingToCustomerLedger(!rodUnloadingToCustomerLedger)}
                                    className={cn(
                                      "text-[9px] font-black px-1.5 py-0.5 rounded border select-none cursor-pointer transition-colors",
                                      rodUnloadingToCustomerLedger 
                                        ? "bg-emerald-100 text-emerald-800 border-emerald-300" 
                                        : "bg-slate-200 text-slate-600 border-slate-300"
                                    )}
                                  >
                                    {rodUnloadingToCustomerLedger ? 'কাস্টমার লেজারে যুক্ত' : 'দোকান প্রদেয় / লেজারে বাদ'}
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-slate-500 font-medium">আনলোডিং রেট (৳/কেজি)</span>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={rodUnloadingRateInput}
                                    onChange={e => handleRodUnloadingRateChange(e.target.value)}
                                    placeholder="০.০০"
                                    className={cn(
                                      "rounded-md h-9 bg-white text-xs font-bold font-bengali transition-colors",
                                      rodUnloadingToCustomerLedger ? "border-emerald-300 text-slate-800" : "border-slate-300 text-slate-800"
                                    )}
                                  />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500 font-medium">মোট আনলোডিং (৳)</span>
                                    <span className="text-[9px] text-emerald-700 font-bold">(রাউন্ড/এডিটযোগ্য)</span>
                                  </div>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={rodUnloadingTotalInput !== '' ? rodUnloadingTotalInput : (rodUnloadingTotal > 0 ? String(rodUnloadingTotal) : '')}
                                    onChange={e => setRodUnloadingTotalInput(formatDecimalInput(e.target.value))}
                                    placeholder={rodUnloadingTotal > 0 ? String(rodUnloadingTotal) : '০.০০'}
                                    className={cn(
                                      "rounded-md h-9 bg-white text-xs font-bold font-bengali transition-colors",
                                      rodUnloadingToCustomerLedger ? "border-emerald-300 text-emerald-800" : "border-slate-300 text-slate-700"
                                    )}
                                  />
                                </div>
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium block",
                                rodUnloadingToCustomerLedger ? "text-emerald-800" : "text-amber-800"
                              )}>
                                {rodUnloadingToCustomerLedger 
                                  ? '💡 রড আনলোডিং খরচ কাস্টমারের বিলে ও লেজারে যুক্ত হবে।' 
                                  : '💡 রড আনলোডিং খরচ কাস্টমারের বিলে বা লেজারে যুক্ত হবে না (দোকান বহন করবে / আলাদা হিসাব)।'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Cement Rate Box */}
                        {(cementTotalBags > 0 || (rodRingTotalKg === 0 && cementTotalBags === 0)) && (
                          <div className="bg-amber-50/60 border border-amber-200 rounded-md p-3 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-black text-amber-900 flex items-center gap-1.5">
                                🔸 সিমেন্ট লোডিং ও আনলোডিং খরচ (বস্তা হিসেবে)
                              </span>
                              <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-[11px]">
                                ফেরত সিমেন্ট: {toBengaliDigits(cementTotalBags.toLocaleString('en-IN'))} বস্তা
                              </span>
                            </div>

                            {/* Cement Loading Section */}
                            <div className={cn(
                              "space-y-1.5 p-2 rounded-md transition-all",
                              cementLoadingToCustomerLedger ? "bg-amber-100/50 border border-amber-300" : "bg-slate-50/80 border border-slate-200"
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-[11px] font-bold text-slate-700">লোডিং লেবার খরচ</Label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={cementLoadingToCustomerLedger}
                                    onClick={() => setCementLoadingToCustomerLedger(!cementLoadingToCustomerLedger)}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-amber-500",
                                      cementLoadingToCustomerLedger ? "bg-amber-600" : "bg-slate-300"
                                    )}
                                    title="কাস্টমারের লেজারে যুক্ত বা বাদ দিতে ক্লিক করুন"
                                  >
                                    <span
                                      className={cn(
                                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                                        cementLoadingToCustomerLedger ? "translate-x-4" : "translate-x-0"
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCementLoadingToCustomerLedger(!cementLoadingToCustomerLedger)}
                                    className={cn(
                                      "text-[9px] font-black px-1.5 py-0.5 rounded border select-none cursor-pointer transition-colors",
                                      cementLoadingToCustomerLedger 
                                        ? "bg-amber-200 text-amber-900 border-amber-400" 
                                        : "bg-slate-200 text-slate-600 border-slate-300"
                                    )}
                                  >
                                    {cementLoadingToCustomerLedger ? 'কাস্টমার লেজারে যুক্ত' : 'দোকান প্রদেয় / লেজারে বাদ'}
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-slate-500 font-medium">রেট (৳/বস্তা)</span>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={cementLaborRateInput}
                                    onChange={e => handleCementLaborRateChange(e.target.value)}
                                    placeholder="০.০০"
                                    className="rounded-md h-9 bg-white border-amber-300 text-xs font-bold text-slate-800 font-bengali"
                                  />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500 font-medium">মোট লোডিং (৳)</span>
                                    <span className="text-[9px] text-amber-700 font-bold">(রাউন্ড/এডিটযোগ্য)</span>
                                  </div>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={cementLaborTotalInput !== '' ? cementLaborTotalInput : (cementLaborTotal > 0 ? String(cementLaborTotal) : '')}
                                    onChange={e => setCementLaborTotalInput(formatDecimalInput(e.target.value))}
                                    placeholder={cementLaborTotal > 0 ? String(cementLaborTotal) : '০.০০'}
                                    className="rounded-md h-9 bg-white border-amber-300 text-xs font-bold text-amber-700 font-bengali"
                                  />
                                </div>
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium block",
                                cementLoadingToCustomerLedger ? "text-amber-900" : "text-amber-800"
                              )}>
                                {cementLoadingToCustomerLedger 
                                  ? '💡 সিমেন্ট লোডিং খরচ কাস্টমারের বিলে ও লেজারে যুক্ত হবে।' 
                                  : '💡 লোডিং খরচ কাস্টমারের বিলে যুক্ত হবে না, দোকান লোডিং বিল হিসেবে পরিশোধ হবে।'}
                              </span>
                            </div>

                            {/* Cement Unloading Section */}
                            <div className={cn(
                              "pt-2 border-t border-amber-200/80 space-y-1.5 p-2 rounded-md transition-all",
                              cementUnloadingToCustomerLedger ? "bg-emerald-50/40" : "bg-slate-50/80 border border-slate-200"
                            )}>
                              <div className="flex items-center justify-between gap-2">
                                <Label className="text-[11px] font-bold text-slate-700">আনলোডিং লেবার খরচ</Label>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={cementUnloadingToCustomerLedger}
                                    onClick={() => setCementUnloadingToCustomerLedger(!cementUnloadingToCustomerLedger)}
                                    className={cn(
                                      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-emerald-500",
                                      cementUnloadingToCustomerLedger ? "bg-emerald-600" : "bg-slate-300"
                                    )}
                                    title="কাস্টমারের লেজারে যুক্ত বা বাদ দিতে ক্লিক করুন"
                                  >
                                    <span
                                      className={cn(
                                        "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                                        cementUnloadingToCustomerLedger ? "translate-x-4" : "translate-x-0"
                                      )}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setCementUnloadingToCustomerLedger(!cementUnloadingToCustomerLedger)}
                                    className={cn(
                                      "text-[9px] font-black px-1.5 py-0.5 rounded border select-none cursor-pointer transition-colors",
                                      cementUnloadingToCustomerLedger 
                                        ? "bg-emerald-100 text-emerald-800 border-emerald-300" 
                                        : "bg-slate-200 text-slate-600 border-slate-300"
                                    )}
                                  >
                                    {cementUnloadingToCustomerLedger ? 'কাস্টমার লেজারে যুক্ত' : 'লেজারে যুক্ত নয়'}
                                  </button>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="space-y-0.5">
                                  <span className="text-[10px] text-slate-500 font-medium">রেট (৳/বস্তা)</span>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={cementUnloadingRateInput}
                                    onChange={e => handleCementUnloadingRateChange(e.target.value)}
                                    placeholder="০.০০"
                                    className={cn(
                                      "rounded-md h-9 bg-white text-xs font-bold font-bengali transition-colors",
                                      cementUnloadingToCustomerLedger ? "border-emerald-300 text-slate-800" : "border-slate-300 text-slate-800"
                                    )}
                                  />
                                </div>
                                <div className="space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-500 font-medium">মোট আনলোডিং (৳)</span>
                                    <span className="text-[9px] text-emerald-700 font-bold">(রাউন্ড/এডিটযোগ্য)</span>
                                  </div>
                                  <Input 
                                    type="text"
                                    inputMode="decimal"
                                    value={cementUnloadingTotalInput !== '' ? cementUnloadingTotalInput : (cementUnloadingTotal > 0 ? String(cementUnloadingTotal) : '')}
                                    onChange={e => setCementUnloadingTotalInput(formatDecimalInput(e.target.value))}
                                    placeholder={cementUnloadingTotal > 0 ? String(cementUnloadingTotal) : '০.০০'}
                                    className={cn(
                                      "rounded-md h-9 bg-white text-xs font-bold font-bengali transition-colors",
                                      cementUnloadingToCustomerLedger ? "border-emerald-300 text-emerald-800" : "border-slate-300 text-slate-700"
                                    )}
                                  />
                                </div>
                              </div>
                              <span className={cn(
                                "text-[10px] font-medium block",
                                cementUnloadingToCustomerLedger ? "text-emerald-800" : "text-amber-800"
                              )}>
                                {cementUnloadingToCustomerLedger 
                                  ? '💡 আনলোডিং খরচ কাস্টমারের বিলে ও লেজারে যুক্ত হবে।' 
                                  : '💡 আনলোডিং খরচ কাস্টমারের বিলে বা লেজারে যুক্ত হবে না (দোকান বহন করবে / আলাদা হিসাব)।'}
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Dedicated Vehicle Fare Box */}
                        <div className={cn(
                          "border rounded-md p-3 space-y-2 transition-all",
                          shippingCostToCustomerLedger ? "bg-emerald-50/50 border-emerald-200" : "bg-slate-50/80 border-slate-200"
                        )}>
                          <div className="flex items-center justify-between text-xs gap-2">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
                                🚚 পরিবহন / গাড়ি ভাড়া
                              </Label>
                              <span className="hidden sm:inline text-[10px] text-slate-500">
                                (রেট দিলে হিসাব হবে অথবা সরাসরি মোট ভাড়া লিখুন)
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={shippingCostToCustomerLedger}
                                onClick={() => setShippingCostToCustomerLedger(!shippingCostToCustomerLedger)}
                                className={cn(
                                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-1 focus:ring-emerald-500",
                                  shippingCostToCustomerLedger ? "bg-emerald-600" : "bg-slate-300"
                                )}
                                title="কাস্টমারের লেজারে যুক্ত বা বাদ দিতে ক্লিক করুন"
                              >
                                <span
                                  className={cn(
                                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out",
                                    shippingCostToCustomerLedger ? "translate-x-4" : "translate-x-0"
                                  )}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => setShippingCostToCustomerLedger(!shippingCostToCustomerLedger)}
                                className={cn(
                                  "text-[9px] font-black px-1.5 py-0.5 rounded border select-none cursor-pointer transition-colors",
                                  shippingCostToCustomerLedger 
                                    ? "bg-emerald-100 text-emerald-800 border-emerald-300" 
                                    : "bg-slate-200 text-slate-600 border-slate-300"
                                )}
                              >
                                {shippingCostToCustomerLedger ? 'কাস্টমার লেজারে যুক্ত' : 'লেজারে যুক্ত নয়'}
                              </button>
                            </div>
                          </div>
                          <span className={cn(
                            "text-[10px] font-medium block",
                            shippingCostToCustomerLedger ? "text-emerald-800" : "text-amber-800"
                          )}>
                            {shippingCostToCustomerLedger 
                              ? '💡 গাড়ি ভাড়া কাস্টমারের বিলে ও লেজারে যুক্ত হবে।' 
                              : '💡 গাড়ি ভাড়া কাস্টমারের বিলে বা লেজারে যুক্ত হবে না (দোকান বহন করবে / আলাদা হিসাব)।'}
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {rodRingTotalKg > 0 && (
                              <div className="space-y-0.5">
                                <span className="text-[10px] text-slate-600 font-medium">রড গাড়ি ভাড়া (৳/কেজি)</span>
                                <Input 
                                  type="text"
                                  inputMode="decimal"
                                  value={rodShippingRateInput}
                                  onChange={e => handleRodShippingRateChange(e.target.value)}
                                  placeholder="০.০০"
                                  className="rounded-md h-9 bg-white border-emerald-300 text-xs font-bold text-slate-800 font-bengali"
                                />
                              </div>
                            )}
                            {cementTotalBags > 0 && (
                              <div className="space-y-0.5">
                                <span className="text-[10px] text-slate-600 font-medium">সিমেন্ট গাড়ি ভাড়া (৳/বস্তা)</span>
                                <Input 
                                  type="text"
                                  inputMode="decimal"
                                  value={cementShippingRateInput}
                                  onChange={e => handleCementShippingRateChange(e.target.value)}
                                  placeholder="০.০০"
                                  className="rounded-md h-9 bg-white border-emerald-300 text-xs font-bold text-slate-800 font-bengali"
                                />
                              </div>
                            )}
                            <div className={cn(
                              "space-y-0.5",
                              !(rodRingTotalKg > 0 || cementTotalBags > 0) && "sm:col-span-3",
                              ((rodRingTotalKg > 0 && cementTotalBags === 0) || (cementTotalBags > 0 && rodRingTotalKg === 0)) && "sm:col-span-2"
                            )}>
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] text-slate-800 font-bold">মোট গাড়ি ভাড়া (৳)</span>
                                <span className="text-[9px] text-emerald-700 font-bold">(রাউন্ড/এডিটযোগ্য)</span>
                              </div>
                              <Input 
                                type="text"
                                inputMode="decimal"
                                value={shippingCostInput}
                                onChange={e => setShippingCostInput(formatDecimalInput(e.target.value))}
                                placeholder="০"
                                className={cn(
                                  "rounded-md h-9 bg-white text-xs font-bold font-bengali transition-colors",
                                  shippingCostToCustomerLedger ? "border-emerald-300 text-slate-800" : "border-slate-300 text-slate-700"
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Reason & Quick Selection Pills */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-bold text-slate-700">ফেরতের কারণ ও বিবরণ (Reason)</Label>
                        <span className="text-[11px] text-slate-400 font-semibold">ক্লিক করে কুইক সিলেক্ট করুন:</span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {COMMON_REASONS.map((r, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setReason(r)}
                            className={cn(
                              "px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer",
                              reason === r
                                ? "bg-blue-600 text-white border-blue-600 shadow-2xs"
                                : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100"
                            )}
                          >
                            {r}
                          </button>
                        ))}
                      </div>

                      <Input
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="মালামাল ডেমেজ / কাস্টমারের অপছন্দ / সাইজ সমস্যা / অন্যান্য কারণ..."
                        className="bg-white border-slate-200 text-xs font-bold rounded-md h-10 mt-2"
                      />
                    </CardContent>
                  </Card>
                </div>

                {/* RIGHT 4 COLUMNS: SETTLEMENT & SUMMARY SIDEBAR */}
                <div className="lg:col-span-4 space-y-5">
                  
                  {/* Financial Breakdown Card */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs">
                    <CardContent className="p-5 space-y-4">
                      <Label className="text-xs uppercase tracking-wider font-black text-slate-900 border-b border-slate-100 pb-3 block">
                        📊 হিসাব ও এডজাস্টমেন্ট সামারি
                      </Label>

                      <div className="space-y-3 text-xs">
                        <div className="flex justify-between py-1 border-b border-slate-100">
                          <span className="text-slate-500 font-semibold">কাস্টমারের বর্তমান বকেয়া</span>
                          <span className="font-black text-slate-900">৳ {toBengaliDigits(currentDue.toLocaleString('en-IN'))}</span>
                        </div>

                        <div className="flex justify-between py-1 border-b border-slate-100">
                          <span className="text-slate-500 font-semibold">মোট ফেরত পণ্যের মূল্য</span>
                          <span className="font-black text-rose-600">৳ {toBengaliDigits(totalReturnedValue.toLocaleString('en-IN'))}</span>
                        </div>

                        {customerPayableCharges > 0 && (
                          <div className="flex justify-between py-1 border-b border-slate-100">
                            <span className="text-slate-600 font-semibold">লেবার ও পরিবহন (কাস্টমার প্রদেয়)</span>
                            <span className="font-black text-rose-700">- ৳ {toBengaliDigits(customerPayableCharges.toLocaleString('en-IN'))}</span>
                          </div>
                        )}

                        <div className="flex justify-between py-2 border-b-2 border-slate-200 bg-slate-50 p-2 rounded-md">
                          <span className="font-black text-slate-900">নিট ফেরত মূল্য (Net Balance)</span>
                          <span className="font-black text-base text-rose-600">
                            ৳ {toBengaliDigits(netRefundValue.toLocaleString('en-IN'))}
                          </span>
                        </div>

                        {shopPaidCharges > 0 && (
                          <div className="flex justify-between py-1 border-b border-dashed border-amber-200 text-amber-800 text-[11px]">
                            <span>দোকান প্রদেয় লেবার/গাড়ি ভাড়া</span>
                            <span className="font-bold">৳ {toBengaliDigits(shopPaidCharges.toLocaleString('en-IN'))} (দোকান বহন করবে)</span>
                          </div>
                        )}

                        {/* DUE / ADVANCE LIVE SUMMARY */}
                        {netRefundValue > 0 && selectedCust && (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md space-y-1.5 text-xs">
                            <div className="flex justify-between items-center text-slate-700">
                              <span className="font-semibold">বর্তমান বকেয়া:</span>
                              <span className="font-bold font-mono">৳ {toBengaliDigits(currentDue.toLocaleString('en-IN'))}</span>
                            </div>
                            <div className="flex justify-between items-center text-blue-700">
                              <span className="font-bold">সমন্বয় হবে:</span>
                              <span className="font-black font-mono">- ৳ {toBengaliDigits(dueAdjusted.toLocaleString('en-IN'))}</span>
                            </div>
                            <div className="pt-1.5 border-t border-slate-200 flex justify-between items-center text-slate-900 font-black">
                              <span>অবশিষ্ট বকেয়া:</span>
                              <span className={cn("font-mono font-black", newCustomerDue > 0 ? "text-blue-700" : "text-emerald-700")}>
                                ৳ {toBengaliDigits(newCustomerDue.toLocaleString('en-IN'))}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* INTERACTIVE PAYMENT & CASH REFUND ENTRY CARD */}
                  <Card className="bg-white border-slate-200/80 rounded-md shadow-xs overflow-hidden">
                    <div className="bg-slate-900 text-white p-3.5 px-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Banknote className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-black tracking-wide">রিফান্ড ও পেমেন্ট এন্ট্রি (Payment Entry)</span>
                      </div>
                      {netRefundValue > 0 && (
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-mono font-bold px-2 py-0.5 rounded border border-emerald-500/30">
                          রিফান্ড: ৳ {netRefundValue.toLocaleString()}
                        </span>
                      )}
                    </div>

                    <CardContent className="p-4 space-y-4 text-xs font-bengali">
                      {netRefundValue <= 0 ? (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-slate-500 text-center font-medium">
                          {netRefundValue === 0 
                            ? 'ফেরত ও নতুন নেওয়া পণ্যের মূল্য সমান, কোনো রিফান্ড বা বকেয়া সমন্বয় প্রয়োজন নেই।'
                            : `গ্রাহক অতিরিক্ত মূল্যের পণ্য নিয়েছেন, গ্রাহকের বকেয়া বৃদ্ধি পাবে ৳ ${Math.abs(netRefundValue).toLocaleString()}`
                          }
                        </div>
                      ) : (
                        <>
                          {/* Settlement Mode Selection Pills */}
                          <div>
                            <Label className="text-[11px] font-bold text-slate-700 mb-1.5 block">
                              নিষ্পত্তি পদ্ধতি নির্বাচন করুন:
                            </Label>
                            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200">
                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementMode('due_adjust');
                                  setCashRefundPaidInput(Math.max(0, round2(netRefundValue - currentDue)));
                                }}
                                className={cn(
                                  "py-1.5 px-2 rounded-md font-bold text-[11px] transition-all flex flex-col items-center gap-0.5 cursor-pointer text-center",
                                  settlementMode === 'due_adjust'
                                    ? "bg-white text-blue-700 shadow-xs border border-slate-200 font-black"
                                    : "text-slate-600 hover:text-slate-900"
                                )}
                              >
                                <span>📑 বকেয়া সমন্বয়</span>
                                <span className="text-[9px] font-normal text-slate-400">Due Adjust</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementMode('cash');
                                  setCashRefundPaidInput(netRefundValue);
                                }}
                                className={cn(
                                  "py-1.5 px-2 rounded-md font-bold text-[11px] transition-all flex flex-col items-center gap-0.5 cursor-pointer text-center",
                                  settlementMode === 'cash'
                                    ? "bg-white text-emerald-700 shadow-xs border border-slate-200 font-black"
                                    : "text-slate-600 hover:text-slate-900"
                                )}
                              >
                                <span>💵 নগদ ফেরত</span>
                                <span className="text-[9px] font-normal text-slate-400">Full Cash</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementMode('custom');
                                }}
                                className={cn(
                                  "py-1.5 px-2 rounded-md font-bold text-[11px] transition-all flex flex-col items-center gap-0.5 cursor-pointer text-center",
                                  settlementMode === 'custom'
                                    ? "bg-white text-purple-700 shadow-xs border border-slate-200 font-black"
                                    : "text-slate-600 hover:text-slate-900"
                                )}
                              >
                                <span>⚙️ কাস্টম স্প্লিট</span>
                                <span className="text-[9px] font-normal text-slate-400">Custom</span>
                              </button>
                            </div>
                          </div>

                          {/* Cash Refund Amount Input Box */}
                          <div className="space-y-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                                ক্যাশ ফেরত পরিশোধের পরিমাণ (৳):
                              </Label>
                              <span className="text-xs font-black font-mono text-emerald-700">
                                ৳ {cashRefundPaid.toLocaleString()}
                              </span>
                            </div>

                            <Input
                              type="number"
                              step="any"
                              min="0"
                              max={netRefundValue}
                              value={settlementMode === 'cash' ? netRefundValue : settlementMode === 'due_adjust' ? Math.max(0, round2(netRefundValue - currentDue)) : cashRefundPaidInput}
                              onChange={(e) => {
                                const val = Math.max(0, parseFloat(e.target.value) || 0);
                                setCashRefundPaidInput(val);
                                if (settlementMode !== 'custom') {
                                  setSettlementMode('custom');
                                }
                              }}
                              placeholder="ফেরত দেওয়া টাকার পরিমাণ..."
                              className="bg-white border-slate-300 h-9 text-right font-mono font-black text-sm text-slate-900 rounded-md"
                            />

                            {/* Preset Buttons */}
                            <div className="flex flex-wrap items-center gap-1 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementMode('custom');
                                  setCashRefundPaidInput(0);
                                }}
                                className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-[10px] font-bold text-slate-600 border border-slate-200 cursor-pointer"
                              >
                                ৳ ০ (ক্যাশ নয়)
                              </button>

                              {netRefundValue > 0 && currentDue > 0 && netRefundValue > currentDue && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSettlementMode('custom');
                                    setCashRefundPaidInput(round2(netRefundValue - currentDue));
                                  }}
                                  className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-[10px] font-bold text-blue-700 border border-blue-200 cursor-pointer"
                                >
                                  বকেয়া বাদে বাকি ৳ {(netRefundValue - currentDue).toLocaleString()}
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => {
                                  setSettlementMode('cash');
                                  setCashRefundPaidInput(netRefundValue);
                                }}
                                className="px-2 py-0.5 rounded bg-white hover:bg-slate-100 text-[10px] font-bold text-emerald-700 border border-emerald-200 cursor-pointer ml-auto"
                              >
                                সম্পূর্ণ ৳ {netRefundValue.toLocaleString()} ক্যাশ
                              </button>
                            </div>
                          </div>

                          {/* Payment Method & Bank Account Selection (Visible when cash refund > 0) */}
                          {cashRefundPaid > 0 && (
                            <div className="space-y-3 p-3 bg-blue-50/60 border border-blue-200 rounded-lg">
                              <Label className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                                ক্যাশ ফেরত পরিশোধের মাধ্যম (Payment Method):
                              </Label>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                                {/* Payment Method Dropdown — same as invoice */}
                                <div className="space-y-1">
                                  <Label className="text-[11px] font-bold text-slate-600">পেমেন্ট মাধ্যম</Label>
                                  <Select
                                    value={paymentMethod}
                                    onValueChange={(val: any) => {
                                      setPaymentMethod(val);
                                      if (val === 'cash') setBankAccountId('');
                                    }}
                                  >
                                    <SelectTrigger className="rounded-md h-10 bg-white border-slate-200 text-xs font-bold w-full">
                                      <SelectValue>
                                        {paymentMethod === 'cash' ? '💵 নগদ (Cash)' :
                                         paymentMethod === 'bank' ? '🏦 ব্যাংক ট্রান্সফার' :
                                         paymentMethod === 'mobile_banking' ? '📱 মোবাইল ব্যাংকিং' : '💵 নগদ (Cash)'}
                                      </SelectValue>
                                    </SelectTrigger>
                                    <SelectContent className="text-xs font-bold">
                                      <SelectItem value="cash">💵 নগদ (Cash)</SelectItem>
                                      <SelectItem value="bank">🏦 ব্যাংক ট্রান্সফার</SelectItem>
                                      <SelectItem value="mobile_banking">📱 মোবাইল ব্যাংকিং (বিকাশ/নগদ)</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Paid Amount Display */}
                                <div className="space-y-1">
                                  <Label className="text-[11px] font-bold text-slate-600">পরিশোধের পরিমাণ (৳)</Label>
                                  <div className="h-10 rounded-md bg-emerald-50 border border-emerald-200 flex items-center px-3 font-black text-sm text-emerald-700">
                                    ৳ {cashRefundPaid.toLocaleString()}
                                  </div>
                                </div>
                              </div>

                              {/* Bank Account Selector (Bank / Mobile Banking) */}
                              {(paymentMethod === 'bank' || paymentMethod === 'mobile_banking') && (
                                <div className="p-3 bg-white border border-blue-100 rounded-md space-y-2 animate-in fade-in-0">
                                  <p className="font-bold text-blue-900 text-xs flex items-center gap-1">
                                    {paymentMethod === 'bank' ? '🏦 দোকানের ব্যাংক একাউন্ট (যেখান থেকে দেওয়া হবে)' : '📱 মোবাইল ব্যাংকিং একাউন্ট'}
                                  </p>
                                  <div className="space-y-1">
                                    <Label className="text-[10px] font-bold text-slate-600">একাউন্ট নির্বাচন করুন</Label>
                                    <Select
                                      value={bankAccountId}
                                      onValueChange={(val: string | null) => setBankAccountId(val === 'none' || !val ? '' : val)}
                                    >
                                      <SelectTrigger className="h-9 rounded-md bg-slate-50 text-xs font-bold border-slate-200">
                                        <SelectValue placeholder="-- একাউন্ট নির্বাচন করুন --" />
                                      </SelectTrigger>
                                      <SelectContent className="text-xs font-bold">
                                        {banks.length > 0 ? (
                                          banks.map((b) => (
                                            <SelectItem key={b.id} value={String(b.id)}>
                                              {b.name}{b.account_number ? ` (${b.account_number})` : ''} — ব্যালেন্স: ৳ {Number(b.balance || 0).toLocaleString()}
                                            </SelectItem>
                                          ))
                                        ) : (
                                          <SelectItem value="none" disabled>
                                            ⚠️ কোনো ব্যাংক যুক্ত নেই (আগে ব্যাংক যোগ করুন)
                                          </SelectItem>
                                        )}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Live Settlement Summary & Impact */}
                          <div className="p-3.5 bg-slate-900 text-white rounded-lg space-y-2">
                            <p className="text-[10px] uppercase font-black tracking-wider text-slate-400 border-b border-slate-800 pb-1.5">
                              📌 চূড়ান্ত নিষ্পত্তির ফলাফল (Summary)
                            </p>

                            <div className="space-y-1.5 text-xs">
                              <div className="flex justify-between items-center text-rose-400">
                                <span className="font-semibold flex items-center gap-1">
                                  💵 নগদ ক্যাশ ফেরত প্রদান:
                                </span>
                                <span className="font-mono font-black text-sm">
                                  ৳ {cashRefundPaid.toLocaleString()}
                                  {cashRefundPaid > 0 && (
                                    <span className="text-[10px] ml-1 font-bold text-slate-300">
                                      ({paymentMethod === 'cash' ? 'নগদ' : paymentMethod === 'bank' ? 'ব্যাংক' : 'মোবাইল'})
                                    </span>
                                  )}
                                </span>
                              </div>

                              <div className="flex justify-between items-center text-blue-300">
                                <span className="font-semibold flex items-center gap-1">
                                  📑 বকেয়া সমন্বয়/কর্তন:
                                </span>
                                <span className="font-mono font-black">
                                  ৳ {dueAdjusted.toLocaleString()}
                                </span>
                              </div>

                              {customerAdvanceCreated > 0 && (
                                <div className="flex justify-between items-center text-emerald-400">
                                  <span className="font-semibold flex items-center gap-1">
                                    🎉 গ্রাহকের অগ্রিম জমা:
                                  </span>
                                  <span className="font-mono font-black">
                                    ৳ {customerAdvanceCreated.toLocaleString()}
                                  </span>
                                </div>
                              )}

                              <div className="pt-2 border-t border-slate-800 flex justify-between items-center text-xs font-bold text-slate-200">
                                <span>রিটার্ন পরবর্তী অবশিষ্ট বকেয়া:</span>
                                <span className={cn("font-mono font-black text-sm", newCustomerDue > 0 ? "text-amber-400" : "text-emerald-400")}>
                                  ৳ {newCustomerDue.toLocaleString()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>

                </div>

              </div>

              {/* STICKY BOTTOM ACTION BAR */}
              <div className="bg-white border-t border-slate-300 px-6 py-3.5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm font-bengali flex-shrink-0 mt-6 rounded-b-md">
                <div className="flex items-center gap-2 text-slate-500 text-xs font-semibold">
                  <Lightbulb className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  <span>💡 ভালো পণ্যের স্টক স্বয়ংক্রিয়ভাবে গুদামে যুক্ত হবে এবং কাস্টমার লেজার আপডেট হবে।</span>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <Button 
                    type="button" 
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                    className="rounded-md h-11 px-5 font-bold text-slate-600 border-slate-300 hover:bg-slate-50 cursor-pointer"
                  >
                    বাতিল করুন
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={returnCart.length === 0}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded-md h-11 px-6 font-black shadow-md shadow-blue-600/20 active:scale-95 transition-all text-sm cursor-pointer"
                  >
                    💾 বিক্রয় রিটার্ন ও হিসাব সম্পন্ন করুন ✓
                  </Button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UNIFIED SALES RETURN PRINT MEMO MODAL */}
      <Dialog open={isPrintMemoOpen} onOpenChange={setIsPrintMemoOpen}>
        <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[92vh] overflow-y-auto rounded-2xl p-0 border-none shadow-2xl custom-scrollbar font-bengali">
          <div className="bg-slate-900 p-4 px-6 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden rounded-t-2xl">
            <DialogHeader className="space-y-0 text-left">
              <DialogTitle className="text-xl font-black flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-rose-400" /> বিক্রয় ফেরত ক্যাশ মেমো
              </DialogTitle>
              <p className="text-slate-400 font-mono text-xs mt-0.5">মেমো নং: #{selectedReturn?.id?.toUpperCase()}</p>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Button 
                onClick={() => printElement('printable-memo-wrapper')}
                className="bg-rose-600 hover:bg-rose-700 text-white font-black rounded-xl px-4 h-9 shadow-md flex items-center gap-1.5 text-xs active:scale-95 transition-transform cursor-pointer"
              >
                <Printer className="w-4 h-4" /> মেমো প্রিন্ট করুন
              </Button>
            </div>
          </div>

          {selectedReturn && (
            <div className="p-6 bg-slate-100 max-h-[78vh] overflow-y-auto custom-scrollbar space-y-6 print:max-h-none print:overflow-visible print:p-0 print:bg-white">
              <ReturnInvoiceMemo
                returnEntry={selectedReturn}
                showPrintButton={false}
              />
            </div>
          )}

          <div className="p-4 bg-white border-t border-slate-200 flex justify-between items-center print:hidden rounded-b-2xl">
            <div className="text-xs text-slate-500 font-bold">
              * গ্রাহককে দেওয়ার জন্য এটি প্রস্তুতকৃত অফিসিয়াল বিক্রয় ফেরত মেমো কপি।
            </div>
            <Button variant="outline" onClick={() => setIsPrintMemoOpen(false)} className="rounded-xl font-bold text-slate-600 border-slate-200 cursor-pointer">
              বন্ধ করুন
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* DELETE RETURN CONFIRMATION DIALOG */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md rounded-md p-6 bg-white font-bengali">
          <DialogHeader className="text-center sm:text-left">
            <div className="mx-auto sm:mx-0 w-12 h-12 rounded-md bg-rose-100 text-rose-600 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6" />
            </div>
            <DialogTitle className="text-lg font-black text-slate-900">
              বিক্রয় রিটার্ন রেকর্ডটি মুছে ফেলতে চান?
            </DialogTitle>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              আপনি কি নিশ্চিত যে রিটার্ন রেকর্ড <span className="font-mono font-bold text-slate-700">#{deletingReturn?.id.slice(0, 8).toUpperCase()}</span> মুছে ফেলতে চান? 
              <br /><br />
              <strong className="text-rose-600 block">⚠️ সতর্কতা:</strong>
              রেকর্ডটি মুছে ফেললে স্টক ও কাস্টমার বকেয়া ব্যালেন্স পুনরায় সমন্বয় করা হবে।
            </p>
          </DialogHeader>

          <DialogFooter className="flex gap-2 pt-4 border-t border-slate-100 mt-4">
            <Button 
              variant="outline" 
              onClick={() => { setIsDeleteDialogOpen(false); setDeletingReturn(null); }} 
              className="rounded-md font-bold flex-1 cursor-pointer"
              disabled={isDeleting}
            >
              বাতিল
            </Button>
            <Button 
              onClick={handleDeleteReturnConfirm} 
              disabled={isDeleting}
              className="rounded-md font-black bg-rose-600 hover:bg-rose-700 text-white flex-1 shadow-md shadow-rose-600/20 cursor-pointer"
            >
              {isDeleting ? 'মুছে ফেলা হচ্ছে...' : 'হ্যাঁ, মুছে ফেলুন'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
