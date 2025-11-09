import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { FiSend, FiArrowDown } from "react-icons/fi";
import { RiDeleteBinLine } from "react-icons/ri";
import Header from "../Header";
import Message from "./Message/Message";
import api from "../../services/api";
import "./Chat.css";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const SOCKET_URL = "http://localhost:8080";
const MESSAGE_EVENT = "newMessage";
const DELETE_EVENT = "deleteMessage";
const EDIT_EVENT = "editMessage";
const ONLINE_EVENT = "updateOnlineUsers";

const Chat = () => {
  const { clubId } = useParams();
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [clubName, setClubName] = useState("");
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [loggedInUser, setLoggedInUser] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [clubCreatorId, setClubCreatorId] = useState(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const messagesRef = useRef(null);
  const socketRef = useRef(null);

  const scrollToBottom = useCallback((behavior = "auto") => {
    if (!messagesRef.current) {
      return;
    }
    messagesRef.current.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior,
    });
  }, []);

  const ensureToken = () => {
    const token = localStorage.getItem("token");
    if (!token) {
      toast.error("Session expired. Please sign in again.");
      return null;
    }
    return token;
  };

  const fetchClubDetails = useCallback(async () => {
    if (!clubId) {
      return;
    }
    try {
      const { data } = await api.get(`/clubs/${clubId}`);
      setClubName(data?.name ?? "Club Chat");
      setMembers(Array.isArray(data?.members) ? data.members : []);
      setClubCreatorId(data?.createdBy?._id ?? null);
    } catch (error) {
      console.error("Error fetching club details:", error);
      toast.error("Unable to load club details.");
    }
  }, [clubId]);

  const fetchLoggedInUser = useCallback(async () => {
    const token = ensureToken();
    if (!token) {
      return;
    }
    try {
      const { data } = await api.get("/auth/me");
      setLoggedInUser(data);
    } catch (error) {
      console.error("Error fetching current user:", error);
      toast.error("Unable to load your profile. Please re-login.");
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    if (!clubId) {
      return;
    }
    try {
      const { data } = await api.get(`/messages/${clubId}`);
      setMessages(Array.isArray(data) ? data : []);
      requestAnimationFrame(() => scrollToBottom("auto"));
    } catch (error) {
      console.error("Error fetching messages:", error);
      toast.error("Unable to load messages.");
    }
  }, [clubId, scrollToBottom]);

  useEffect(() => {
    fetchClubDetails();
  }, [fetchClubDetails]);

  useEffect(() => {
    fetchLoggedInUser();
  }, [fetchLoggedInUser]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  useEffect(() => {
    if (!loggedInUser || !clubId) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      query: { userId: loggedInUser._id, clubId },
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.emit("joinRoom", { clubId, userId: loggedInUser._id });

    socket.on(MESSAGE_EVENT, (incoming) => {
      setMessages((prev) => {
        if (incoming?._id && prev.some((msg) => msg._id === incoming._id)) {
          return prev;
        }
        return [...prev, incoming];
      });
      scrollToBottom("smooth");
    });

    const handleOnlineUpdate = (onlineList) => {
      if (Array.isArray(onlineList)) {
        setOnlineUsers(onlineList.map(String));
      }
    };

    socket.on(ONLINE_EVENT, handleOnlineUpdate);
    socket.on("onlineUsers", handleOnlineUpdate);

    socket.on(DELETE_EVENT, (payload) => {
      const deletedId =
        typeof payload === "string"
          ? payload
          : payload?.messageId || payload?._id;
      if (!deletedId) {
        return;
      }
      const deletedBy =
        payload?.deletedBy ||
        (payload?.isAdmin
          ? "admin"
          : payload?.isCreator
          ? "creator"
          : undefined);

      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === deletedId
            ? {
                ...msg,
                deleted: true,
                deletedBy: deletedBy ?? msg.deletedBy,
              }
            : msg
        )
      );
    });

    socket.on(EDIT_EVENT, (editedMessage) => {
      if (!editedMessage?._id) {
        return;
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === editedMessage._id ? { ...msg, ...editedMessage } : msg
        )
      );
    });

    return () => {
      socket.off(MESSAGE_EVENT);
      socket.off(ONLINE_EVENT, handleOnlineUpdate);
      socket.off("onlineUsers", handleOnlineUpdate);
      socket.off(DELETE_EVENT);
      socket.off(EDIT_EVENT);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [clubId, loggedInUser, scrollToBottom]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return undefined;
    }
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      setShowScrollButton(scrollTop + clientHeight < scrollHeight - 80);
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [messages]);

  const onlineCount = useMemo(() => onlineUsers.length, [onlineUsers]);
  const onlineSet = useMemo(() => new Set(onlineUsers), [onlineUsers]);

  const toggleDropdown = useCallback((messageId) => {
    setOpenDropdownId((prev) => (prev === messageId ? null : messageId));
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        !event.target.closest(".dropdown-menu") &&
        !event.target.closest(".dropdown-button")
      ) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const startEditMessage = (msg) => {
    setEditMode(true);
    setEditingMessageId(msg._id);
    setMessage(msg.message);
    setOpenDropdownId(null);
  };

  const resetComposer = () => {
    setMessage("");
    setEditMode(false);
    setEditingMessageId(null);
  };

  const handleSendMessage = async () => {
    const trimmed = message.trim();
    if (!trimmed || !loggedInUser || !clubId) {
      return;
    }

    const payload = {
      clubId,
      user: loggedInUser._id,
      username:
        loggedInUser.UserName ||
        loggedInUser.username ||
        loggedInUser.email ||
        "Member",
      avatar: loggedInUser.avatar || "/default-avatar.png",
      message: trimmed,
      timestamp: new Date().toISOString(),
    };

    try {
      if (editMode && editingMessageId) {
        const { data } = await api.put(`/messages/${editingMessageId}`, payload);
        setMessages((prev) =>
          prev.map((msg) => (msg._id === data._id ? { ...msg, ...data } : msg))
        );
        toast.success("Message updated");
      } else {
        const { data } = await api.post("/messages", payload);
        setMessages((prev) =>
          data?._id && prev.some((msg) => msg._id === data._id)
            ? prev
            : [...prev, data]
        );
      }
      resetComposer();
      scrollToBottom("smooth");
    } catch (error) {
      console.error("Send message error:", error);
      toast.error("Unable to send message.");
    }
  };

  const handleDeleteMessage = async (messageId) => {
    if (!messageId || !loggedInUser) {
      return;
    }
    try {
      await api.delete(`/messages/${messageId}`, {
        headers: {
          "x-club-id": clubId,
          "x-user-role": loggedInUser.isAdmin ? "admin" : "user",
        },
      });
      const deletedBy =
        loggedInUser._id === clubCreatorId
          ? "creator"
          : loggedInUser.isAdmin
          ? "admin"
          : "user";
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? {
                ...msg,
                deleted: true,
                deletedBy,
              }
            : msg
        )
      );
      setOpenDropdownId(null);
      toast.success("Message deleted");
    } catch (error) {
      console.error("Delete message error:", error);
      toast.error("You don’t have permission to delete this message.");
    }
  };

  const handleRemoveMember = async (userId) => {
    if (!userId) {
      return;
    }
    try {
      await api.delete(`/clubs/${clubId}/removeMember/${userId}`);
      setMembers((prev) =>
        prev.filter((member) => String(member._id) !== String(userId))
      );
      toast.success("Member removed");
    } catch (error) {
      console.error("Remove member error:", error);
      toast.error("Unable to remove member.");
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  const groupedMessages = useMemo(() => {
    let lastDate = null;
    return messages.map((msg) => {
      const timestampValue = msg.timestamp || msg.createdAt || Date.now();
      const dateObject = new Date(timestampValue);
      const dateKey = dateObject.toDateString();
      const showDateHeader = dateKey !== lastDate;
      lastDate = dateKey;
      return {
        ...msg,
        showDateHeader,
        dateLabel: dateObject.toLocaleDateString(undefined, {
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
        timestamp: timestampValue,
      };
    });
  }, [messages]);

  const onlineLabel = `${onlineCount} Online`;
  const memberLabel = `${members.length} Member${
    members.length === 1 ? "" : "s"
  }`;

  return (
    <div className="chat-container">
      <Header />
      <div className="chat-layout">
        <aside className="members-panel">
          <div className="panel-header">
            <h2 style={{ color: "black" }}>{clubName}</h2>
            <div className="members-status">
              <span style={{ color: "black" }}>{memberLabel}</span>
              <div className="online-indicator">
                <div className="online-dot" />
                <span style={{ color: "black" }}>{onlineLabel}</span>
              </div>
            </div>
          </div>

          <div className="members-list">
            {members.length === 0 ? (
              <p>No members found</p>
            ) : (
              members.map((member) => {
                const memberId = member?._id ? String(member._id) : "";
                const isOnline = memberId ? onlineSet.has(memberId) : false;
                const canRemove =
                  (loggedInUser?._id === clubCreatorId ||
                    loggedInUser?.isAdmin) &&
                  memberId !== String(loggedInUser?._id);

                return (
                  <div key={memberId || member.email} className="member-item">
                    <div className="member-info">
                      <span
                        className={`presence-dot ${
                          isOnline ? "online" : "offline"
                        }`}
                        aria-hidden="true"
                      />
                      <img
                        src={
                          member.avatar
                            ? `http://localhost:8080${member.avatar}`
                            : "/default-avatar.png"
                        }
                        alt={member.UserName ?? "Member"}
                        className="member-avatar"
                        onError={(event) => {
                          event.target.src = "/default-avatar.png";
                        }}
                      />
                      <span className="member-name">
                        {member.UserName ?? "Unknown Member"}
                      </span>
                    </div>
                    {canRemove && (
                      <button
                        className="remove-member-button"
                        onClick={() => handleRemoveMember(memberId)}
                      >
                        <RiDeleteBinLine size={18} />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="chat-panel">
          <div className="panel-header">
            <h3 style={{ color: "black" }}>{clubName} Chat</h3>
          </div>

          <div className="messages-container" ref={messagesRef}>
            {groupedMessages.map((msg) => (
              <React.Fragment key={msg._id ?? msg.timestamp}>
                {msg.showDateHeader && (
                  <div className="date-header">{msg.dateLabel}</div>
                )}
                <Message
                  message={msg}
                  own={msg.user === loggedInUser?._id}
                  username={msg.username}
                  profileImage={msg.avatar}
                  onEdit={() => startEditMessage(msg)}
                  onDelete={() => handleDeleteMessage(msg._id)}
                  currentUserId={loggedInUser?._id}
                  clubCreatorId={clubCreatorId}
                  openDropdownId={openDropdownId}
                  toggleDropdown={toggleDropdown}
                  loggedInUser={loggedInUser}
                />
              </React.Fragment>
            ))}
          </div>

          {showScrollButton && (
            <button
              type="button"
              className="scroll-to-bottom"
              onClick={() => scrollToBottom("smooth")}
              aria-label="Scroll to latest message"
            >
              <FiArrowDown className="scroll-icon" size={18} />
            </button>
          )}

          <div className="message-input">
            <input
              style={{ color: "black" }}
              type="text"
              placeholder={
                editMode ? "Update your message..." : "Type your message..."
              }
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            {editMode && (
              <button
                type="button"
                className="cancel-edit"
                onClick={resetComposer}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleSendMessage}
              className="send-button"
              aria-label={editMode ? "Update message" : "Send message"}
            >
              <FiSend className="send-icon" size={22} />
            </button>
          </div>
        </section>
      </div>
      <ToastContainer position="top-center" autoClose={3000} />
    </div>
  );
};

export default Chat;
