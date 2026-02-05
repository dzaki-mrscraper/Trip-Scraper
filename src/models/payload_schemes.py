from pydantic import BaseModel, Field
from typing import List, Optional, Any
from datetime import datetime

class FlightSegment(BaseModel):
    sequence: int
    dport: str
    aport: str
    takeofftime: str

class SegmentInfo(BaseModel):
    segmentno: int
    segments: List[FlightSegment]

class FlightInformation(BaseModel):
    segmentinfo: List[SegmentInfo]
    airlineclass: str
    adult: int
    child: int
    infant: int

class BusinessData(BaseModel):
    enterTs: int
    instKey: str
    npmVersion: str
    npmEnterTs: int
    init_cki: str
    bizTokens: List[str] = Field(default_factory=list)
    eid: Optional[str] = None
    framework: str = "web-core"
    tcpSend: bool = False
    isSupportWasm: bool = True
    isOverseas: str = "true"
    tld: str = "trip.com"
    captainAppId: str = "100014851"
    lsSize: int = 17999
    ubt_language: str
    ubt_currency: str
    ubt_site: str
    ubt_locale: str
    wcVersion: str = "2.0.91"
    flighttype: str
    flightinformation: FlightInformation
    ubt_user_data_length: int = Field(alias='__ubt_user_data_length')
    ubt_reqid: str
    
    class Config:
        populate_by_name = True

class PayloadSchema(BaseModel):
    context: List[Any]
    business: List[Any]
    user: List[Optional[str]]
    ubtList: List[List[Any]]
    sendTs: int
    
    class Config:
        json_encoders = {
            datetime: lambda v: int(v.timestamp() * 1000)
        }
    
    @classmethod
    def create_flight_payload(
        cls,
        dcity: str,
        acity: str,
        ddate: str,
        rdate: Optional[str] = None,
        **kwargs
    ) -> 'PayloadSchema':
        """Factory method with validation"""
        # Similar to dataclass version but with Pydantic validation
        # ... implementation ...
        pass