import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast, ToastContainer } from "react-toastify";
import Header from "../components/Header";
import Footer from "../components/Footer";
import api from "../services/api";
import "../pages/AdminRequestsPage.css";
import "react-toastify/dist/ReactToastify.css";

const TAB_KEYS = ["pending", "approved", "rejected"];

const AdminRequestsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pendingRequests, setPendingRequests] = useState([]);
  const [approvedRequests, setApprovedRequests] = useState([]);
  const [rejectedRequests, setRejectedRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const activeTab = useMemo(() => {
    const tab = searchParams.get("tab");
    return TAB_KEYS.includes(tab) ? tab : "pending";
  }, [searchParams]);

  const token = localStorage.getItem("token");

  const fetchRequests = useCallback(async () => {
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    try {
      setLoading(true);
      setError("");
      const { data } = await api.get("/book-requests/admin/all");
      setPendingRequests(data?.pendingRequests ?? []);
      setApprovedRequests(data?.approvedRequests ?? []);
      setRejectedRequests(data?.rejectedRequests ?? []);
    } catch (requestError) {
      const message =
        requestError.response?.data?.message ||
        requestError.response?.data?.error ||
        "Failed to load requests. Please try again.";
      setError(message);
      console.error("Error fetching book requests:", requestError);

      if (requestError.response?.status === 401) {
        toast.error("Your session has expired. Please sign in again.");
        navigate("/login", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [navigate, token]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleStatusUpdate = async (requestId, status) => {
    if (!requestId) {
      return;
    }

    if (status === "Rejected" && !reason.trim()) {
      toast.error("Please provide a reason before rejecting a request.");
      return;
    }

    try {
      const payload = {
        status,
        ...(status === "Rejected" ? { reason: reason.trim() } : {}),
      };

      const { data } = await api.put(
        `/book-requests/admin/${requestId}`,
        payload
      );

      if (!data) {
        throw new Error("Empty response from server");
      }

      toast.success(
        status === "Approved"
          ? `Book request "${data.bookTitle}" approved successfully.`
          : `Book request "${data.bookTitle}" rejected.`
      );

      await fetchRequests();
      setReason("");
      setSelectedRequest(null);
      setSearchParams({ tab: status.toLowerCase() });
    } catch (updateError) {
      const message =
        updateError.response?.data?.message ||
        updateError.response?.data?.error ||
        updateError.message;
      toast.error(`Failed to update request: ${message}`);
      console.error("Update error:", updateError);
    }
  };

  const handleTabChange = (tab) => {
    setSearchParams({ tab });
  };

  const renderRequests = (requests, emptyMessage) => {
    if (requests.length === 0) {
      return <div className="empty-state">{emptyMessage}</div>;
    }

    return requests.map((request) => (
      <div key={request._id} className="request-card">
        <img
          src={
            request.user?.avatar
              ? `http://localhost:8080${request.user.avatar}`
              : "/default-avatar.png"
          }
          alt="User Avatar"
          className="user-avatar"
        />
        <div className="request-info">
          <h3>{request.bookTitle}</h3>
          <p>
            Requested by: {request.user?.UserName} ({request.user?.email})
          </p>
          {activeTab === "pending" && (
            <div className="status-controls">
              <button onClick={() => handleStatusUpdate(request._id, "Approved")}>
                Approve
              </button>
              <button onClick={() => setSelectedRequest(request)}>Reject</button>
            </div>
          )}
          {activeTab === "approved" && (
            <p className="status-approved">Approved</p>
          )}
          {activeTab === "rejected" && (
            <>
              <p className="status-rejected">Rejected</p>
              {request.reason && (
                <p>
                  <strong>Reason:</strong> {request.reason}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    ));
  };

  return (
    <div className="admin-requests-page">
      <Header />
      <main className="admin-requests-content">
        <div className="container">
          <h2>Manage Book Requests</h2>
          {error && <div className="error-message">{error}</div>}

          {loading ? (
            <div className="loading-state">
              <span className="spinner" aria-hidden="true" />
              <p>Loading requests…</p>
            </div>
          ) : (
            <>
              <div className="tab-buttons">
                <button
                  className={activeTab === "pending" ? "active" : ""}
                  onClick={() => handleTabChange("pending")}
                >
                  Pending ({pendingRequests.length})
                </button>
                <button
                  className={activeTab === "approved" ? "active" : ""}
                  onClick={() => handleTabChange("approved")}
                >
                  Approved ({approvedRequests.length})
                </button>
                <button
                  className={activeTab === "rejected" ? "active" : ""}
                  onClick={() => handleTabChange("rejected")}
                >
                  Rejected ({rejectedRequests.length})
                </button>
              </div>

              <div className="request-list">
                {activeTab === "pending" &&
                  renderRequests(pendingRequests, "No pending requests")}
                {activeTab === "approved" &&
                  renderRequests(approvedRequests, "No approved requests")}
                {activeTab === "rejected" &&
                  renderRequests(rejectedRequests, "No rejected requests")}
              </div>
            </>
          )}
        </div>

        {selectedRequest && (
          <div className="popup-overlay">
            <div className="popup-content">
              <h3>Reject Book Request</h3>
              <p>Book: {selectedRequest.bookTitle}</p>
              <textarea
                placeholder="Enter rejection reason (required)"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
              <div className="popup-buttons">
                <button
                  onClick={() => handleStatusUpdate(selectedRequest._id, "Rejected")}
                  disabled={!reason.trim()}
                >
                  Confirm Reject
                </button>
                <button
                  onClick={() => {
                    setSelectedRequest(null);
                    setReason("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <ToastContainer position="top-right" autoClose={3000} />
      <Footer />
    </div>
  );
};

export default AdminRequestsPage;
