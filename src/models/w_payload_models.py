from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Any

@dataclass
class TravelerNum:
    """Passenger count details"""
    adult: int
    child: int
    infant: int

@dataclass
class SearchInfo:
    """Search information containing traveler details"""
    travelerNum: TravelerNum

@dataclass
class AllianceInfo:
    """Alliance information for the request"""
    AllianceID: int = 0
    SID: int = 0
    OuID: str = ""
    UseDistributionType: int = 1

@dataclass
class ExtendFields:
    """Extended fields for additional request metadata"""
    PageId: str
    Os: str = "Windows"
    OsVersion: str = "10"
    SpecialSupply: str = ""
    BatchedId: str = ""
    flightsignature: str = ""

@dataclass
class Head:
    """Request header information"""
    AbTesting: str
    Locale: str 
    VID: str
    AllianceInfo: AllianceInfo
    TransactionID: str
    ExtendFields: ExtendFields
    ClientID: str
    Group: str = "Trip"
    Source: str = "ONLINE"
    Currency: str = "IDR"
    Version: str = "3"
    SessionId: str = "1"
    PvId: str = "13"

@dataclass
class WPayload:
    """Main W payload structure for flight search"""
    dCity: str
    aCity: str
    dDate: str
    flightWayType: str
    departureAirport: str = ""
    arrivalAirport: str = ""
    cabinClass: str = "Economy"
    transferType: str = "ANY"
    searchInfo: SearchInfo = None
    abtList: List[Any] = None
    offSet: int = 30
    aDate: str = ""
    startInterval: int = 2
    endInterval: int = 2
    Head: Head = None
    
    def __post_init__(self):
        """Initialize default values for mutable fields"""
        if self.abtList is None:
            self.abtList = []
    
    @classmethod
    def from_input_payload(
        cls,
        input_payload: Dict[str, Any],
        trip_type_mapping: Dict[int, str]
    ) -> 'WPayload':
        """
        Factory method to create WPayload from input payload
        
        Args:
            input_payload: The input search payload
            trip_type_mapping: Mapping of trip types (1: OW, 2: RT, 3: MT)
            
        Returns:
            WPayload instance
        """
        head_key = 'head'
        
        # Extract journey information
        journey_info = input_payload['searchCriteria']['journeyInfoTypes']
        journey_info_0 = journey_info[0]
        journey_info_1 = journey_info[1] if len(journey_info) > 1 else None
        
        # Parse extensions
        extensions = {
            ext['name']: ext.get('value', '') 
            for ext in input_payload[head_key]['extension']
        }
        
        # Build AbTesting string from abtList
        ab_testing_parts = []
        for i, abt in enumerate(input_payload.get('abtList', [])):
            # Generate random number between 0-100
            import random
            random_num = random.randint(0, 100)
            ab_code = abt.get('abCode', '')
            ab_version = abt.get('abVersion', 'A')
            ab_testing_parts.append(f"M:{random_num},{ab_code}:{ab_version}")
        
        ab_testing = ';'.join(ab_testing_parts) + ';' if ab_testing_parts else ''
        
        # Extract passenger counts
        passenger_info = input_payload['searchCriteria']['passengerInfoType']
        traveler_num = TravelerNum(
            adult=passenger_info['adultCount'],
            child=passenger_info['childCount'],
            infant=passenger_info['infantCount']
        )
        
        # Build search info
        search_info = SearchInfo(travelerNum=traveler_num)
        
        # Build extended fields
        # Parse x-ua safely: format is "v=3_os=ONLINE_osv=10"
        os_name = 'Mac OS'
        os_version = '10.15.7'
        if 'x-ua' in extensions and extensions['x-ua']:
            try:
                parts = extensions['x-ua'].split('_')
                for part in parts:
                    if part.startswith('os='):
                        os_name = part.replace('os=', '')
                    elif part.startswith('osv='):
                        os_version = part.replace('osv=', '')
            except:
                pass  # Use defaults
        
        extend_fields = ExtendFields(
            PageId=extensions.get('PageId', ''),
            Os=os_name,
            OsVersion=os_version,
            BatchedId=extensions.get('Flt_BatchId', '')
        )
        
        # Build alliance info
        alliance_info = AllianceInfo(
            AllianceID=int(extensions.get('allianceID', '0')),
            SID=int(extensions.get('sid', '0')),
            OuID=extensions.get('ouid', ''),
            UseDistributionType=int(extensions.get('useDistributionType', '1'))
        )
        
        # Build head
        head = Head(
            AbTesting=ab_testing,
            Locale=extensions.get('sotpLocale', '') or input_payload[head_key].get('Locale', 'en-ID'),
            VID=extensions.get('vid', ''),
            AllianceInfo=alliance_info,
            TransactionID=extensions.get('flt_app_session_transactionId', ''),
            ExtendFields=extend_fields,
            ClientID=input_payload[head_key].get('cid', '') or input_payload[head_key].get('ClientID', ''),
            Group=extensions.get('sotpGroup', 'Trip'),
            Source=extensions.get('source', 'ONLINE'),
            Currency=extensions.get('sotpCurrency', '') or input_payload[head_key].get('Currency', 'IDR'),
            Version=input_payload[head_key].get('cver', '3'),
            SessionId=extensions.get('Flt_SessionId', '1'),
            PvId=extensions.get('pvid', '3')
        )
        
        # Get trip type
        trip_type = input_payload['searchCriteria']['tripType']
        flight_way_type = trip_type_mapping.get(trip_type, "RT")
        
        return cls(
            dCity=journey_info_0['departCode'].upper(),
            aCity=journey_info_0['arriveCode'].upper(),
            dDate=journey_info_0['departDate'],
            flightWayType=flight_way_type,
            searchInfo=search_info,
            aDate=journey_info_1['departDate'] if journey_info_1 else "",
            Head=head
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """
        Convert payload to dictionary for JSON serialization
        
        Returns:
            Dictionary representation of the payload
        """
        return asdict(self)
