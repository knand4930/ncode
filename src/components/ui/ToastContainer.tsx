import { useEffect } from "react";
import { X, Info, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { useUIStore, ToastType } from "../../store/uiStore";

const ICONS: Record<ToastType, JSX.Element> = {
  info: <Info size={16} className="toast-icon info" />,
  success: <CheckCircle2 size={16} className="toast-icon success" />,
  warning: <AlertTriangle size={16} className="toast-icon warning" />,
  error: <XCircle size={16} className="toast-icon error" />,
};

export function ToastContainer() {
  const { toasts, removeToast } = useUIStore();

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem 
          key={toast.id} 
          toast={toast} 
          onClose={() => removeToast(toast.id)} 
        />
      ))}
    </div>
  );
}

function ToastItem({ toast, onClose }: { toast: any; onClose: () => void }) {
  useEffect(() => {
    // Auto-dismiss after 5 seconds
    const timer = setTimeout(() => {
      onClose();
    }, 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  return (
    <div className={`toast-item ${toast.type}`}>
      {ICONS[toast.type as ToastType]}
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  );
}
