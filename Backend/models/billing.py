from sqlalchemy import Column, String, DateTime, ForeignKey, Integer
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from database import Base

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    # plan: 'free', 'starter', 'growth', 'enterprise'
    # Used in admin.py: PLAN_MRR.get(s.plan.lower())
    plan = Column(String, default="free", nullable=False)
    
    # status: 'active', 'canceled', 'past_due'
    # Used in admin.py: filter(Subscription.status == "active")
    status = Column(String, default="active", nullable=False)
    
    # Stripe / Provider references (useful for real-world billing)
    stripe_subscription_id = Column(String, nullable=True)
    stripe_customer_id = Column(String, nullable=True)

    # Timing fields for revenue calculation
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Used in admin.py for revenue_this_month logic
    renewed_at = Column(DateTime, default=datetime.utcnow)

    # Relationship back to the user
    owner = relationship("UserModel", back_populates="subscription")

    def __repr__(self):
        return f"<Subscription(owner_id={self.owner_id}, plan={self.plan}, status={self.status})>"