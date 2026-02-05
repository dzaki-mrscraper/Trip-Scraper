from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from datetime import datetime

@dataclass
class FlightSegment:
    sequence: int
    dport: str
    aport: str
    takeofftime: str

@dataclass
class SegmentInfo:
    segmentno: int
    segments: List[FlightSegment]

@dataclass
class FlightInformation:
    segmentinfo: List[SegmentInfo]
    airlineclass: str
    adult: int
    child: int
    infant: int

@dataclass
class BusinessData:
    enterTs: int
    instKey: str
    npmVersion: str
    npmEnterTs: int
    init_cki: str
    bizTokens: List[str]
    eid: Optional[str]
    framework: str
    tcpSend: bool
    isSupportWasm: bool
    isOverseas: str
    tld: str
    captainAppId: str
    lsSize: int
    ubt_language: str
    ubt_currency: str
    ubt_site: str
    ubt_locale: str
    wcVersion: str
    flighttype: str
    flightinformation: FlightInformation
    _ubt_user_data_length: int
    ubt_reqid: str

@dataclass
class UbtEvent:
    event_type: int
    timestamp: int
    action: str
    data1: Optional[Any] = None
    data2: Optional[Any] = None

@dataclass
class PayloadData:
    context: List[Any]
    business: List[Any]
    user: List[Optional[str]]
    ubtList: List[List[Any]]
    sendTs: int
    
    @classmethod
    def create_flight_payload(
        cls,
        dcity: str,
        acity: str,
        ddate: str,
        rdate: Optional[str] = None,
        adult: int = 1,
        child: int = 0,
        infant: int = 0,
        cabin_class: str = "Y",
        currency: str = "IDR",
        locale: str = "en-ID",
        **kwargs
    ) -> 'PayloadData':
        """Factory method to create flight search payload"""
        
        timestamp = int(datetime.now().timestamp() * 1000)
        
        # Build segments
        segments = [
            SegmentInfo(
                segmentno=1,
                segments=[FlightSegment(1, dcity, acity, ddate)]
            )
        ]
        
        if rdate:  # Round trip
            segments.append(
                SegmentInfo(
                    segmentno=2,
                    segments=[FlightSegment(1, acity, dcity, rdate)]
                )
            )
        
        flight_info = FlightInformation(
            segmentinfo=segments,
            airlineclass=cabin_class,
            adult=adult,
            child=child,
            infant=infant
        )
        
        business_data = BusinessData(
            enterTs=timestamp,
            instKey=kwargs.get('instKey', '66d8UU'),
            npmVersion="1.6.5",
            npmEnterTs=timestamp - 123,
            init_cki=kwargs.get('init_cki', ''),
            bizTokens=[],
            eid=None,
            framework="web-core",
            tcpSend=False,
            isSupportWasm=True,
            isOverseas="true",
            tld="trip.com",
            captainAppId="100014851",
            lsSize=17999,
            ubt_language=locale.split('-')[0],
            ubt_currency=currency,
            ubt_site=locale.split('-')[1] if '-' in locale else 'ID',
            ubt_locale=locale,
            wcVersion="2.0.91",
            flighttype="D" if rdate else "OW",
            flightinformation=flight_info,
            _ubt_user_data_length=304,
            ubt_reqid=f"{timestamp}4518iy"
        )
        
        return cls(
            context=cls._build_context(**kwargs),
            business=[None, None, None, None, None, None, None, None, None, None, asdict(business_data)],
            user=[None, kwargs.get('ab_test_string', ''), None, ''],
            ubtList=[[1, timestamp, "pv", None, None]],
            sendTs=timestamp
        )
    
    @staticmethod
    def _build_context(**kwargs) -> List[Any]:
        """Build context array"""
        return [
            kwargs.get('user_id', '10320667452'),
            kwargs.get('session_id', f"{int(datetime.now().timestamp() * 1000)}.65f8Qt49rXge"),
            1,
            6,
            "1.3.78/new/t",
            100014851,
            None,
            None,
            "online",
            kwargs.get('device_id', '09034177410240614425'),
            kwargs.get('url', ''),
            kwargs.get('user_id', '10320667452'),
            5,
            1,
            kwargs.get('screen_width', 1536),
            kwargs.get('screen_height', 864),
            kwargs.get('window_width', 1261),
            kwargs.get('window_height', 27),
            kwargs.get('scroll_height', 47),
            "en-us",
            "",
            "",
            '{"version":"","net":"None","platform":""}',
            1.25,
            '{"fef_name":"","fef_ver":"","rg":"","lang":"en-ID","lizard":""}',
            "SGP-ALI",
            "100014851-0a9aa022-491596-282364",
            None,
            None,
            "",
            True,
            False,
            None,
            None
        ]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'context': self.context,
            'business': self.business,
            'user': self.user,
            'ubtList': self.ubtList,
            'sendTs': self.sendTs
        }